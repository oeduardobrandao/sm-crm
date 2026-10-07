import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Download } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import {
  CONTACTS_KEY,
  CONTACTS_PAGE_SIZE,
  CONTACT_COUNTS_KEY,
  getClientes,
  getContactCounts,
  listInstagramContacts,
  sortClientesByNome,
} from '../../../store';
import { ContactsList } from './ContactsList';
import { exportContactsCsv } from './contactsCsv';
import { useContactsFilters } from './useContactsFilters';

function ymdToDate(ymd: string | null): Date | undefined {
  if (!ymd) return undefined;
  const [y, m, d] = ymd.split('-').map((p) => parseInt(p, 10));
  return new Date(y, m - 1, d);
}

export function ContactsTab() {
  const { t } = useTranslation('automations');
  const isDesktop = useIsDesktop(901);
  const { state, setFilters, setPage } = useContactsFilters();
  const { page, ...filters } = state;

  const [searchInput, setSearchInput] = useState(state.search);
  useEffect(() => setSearchInput(state.search), [state.search]);
  useEffect(() => {
    if (searchInput === state.search) return;
    const id = setTimeout(() => setFilters({ search: searchInput }), 300);
    return () => clearTimeout(id);
  }, [searchInput, state.search, setFilters]);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const countsQuery = useQuery({ queryKey: CONTACT_COUNTS_KEY, queryFn: getContactCounts });
  const counts = useMemo(() => countsQuery.data ?? [], [countsQuery.data]);

  const clientesById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of clientes) if (c.id != null) m.set(c.id, c.nome);
    return m;
  }, [clientes]);

  const clientOptions = useMemo(() => {
    const ids = new Set(counts.map((c) => c.client_id));
    if (filters.clientId != null) ids.add(filters.clientId);
    return sortClientesByNome(clientes.filter((c) => c.id != null && ids.has(c.id)));
  }, [clientes, counts, filters.clientId]);

  const automationOptions = useMemo(
    () => counts.filter((c) => filters.clientId == null || c.client_id === filters.clientId),
    [counts, filters.clientId],
  );

  const listQuery = useQuery({
    queryKey: [CONTACTS_KEY, filters, page],
    queryFn: () => listInstagramContacts(filters, page),
    placeholderData: (prev) => prev,
  });

  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    setExporting(true);
    try {
      const nome = filters.clientId != null ? (clientesById.get(filters.clientId) ?? null) : null;
      const n = await exportContactsCsv(filters, clientesById, nome);
      toast.success(t('contacts.exportDone', { count: n }));
    } catch {
      toast.error(t('contacts.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const total = listQuery.data?.total ?? 0;
  const rows = listQuery.data?.rows ?? [];
  const from = total === 0 ? 0 : (page - 1) * CONTACTS_PAGE_SIZE + 1;
  const to = Math.min(page * CONTACTS_PAGE_SIZE, total);
  const range: DateRange | undefined = filters.from
    ? { from: ymdToDate(filters.from), to: ymdToDate(filters.to) }
    : undefined;
  const hasAnyContact = counts.some((c) => c.total_count > 0);
  const onlyDefaultFilter =
    filters.reachedOnly &&
    filters.clientId == null &&
    filters.automationId == null &&
    !filters.from &&
    !filters.to &&
    !filters.search;

  // A stale ?pagina=N past the last page (filters shrank, contacts purged)
  // would show an empty state with no way back: fall back to page 1.
  const pageOutOfRange =
    listQuery.isSuccess && !listQuery.isPlaceholderData && rows.length === 0 && page > 1;
  useEffect(() => {
    if (pageOutOfRange) setPage(1);
  }, [pageOutOfRange, setPage]);

  return (
    <div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
        {t('contacts.intro')}
      </p>

      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: '1rem' }}>
        <div style={{ width: 220 }}>
          <Select
            value={filters.clientId == null ? 'todos' : String(filters.clientId)}
            onValueChange={(v) => setFilters({ clientId: v === 'todos' ? null : parseInt(v, 10) })}
          >
            <SelectTrigger aria-label={t('contacts.filterClient')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t('contacts.allClients')}</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div style={{ width: 240 }}>
          <Select
            value={filters.automationId ?? 'todas'}
            onValueChange={(v) => setFilters({ automationId: v === 'todas' ? null : v })}
          >
            <SelectTrigger aria-label={t('contacts.filterAutomation')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">{t('contacts.allAutomations')}</SelectItem>
              {automationOptions.map((a) => (
                <SelectItem key={a.automation_id} value={a.automation_id}>
                  {a.automation_deleted
                    ? t('contacts.removed', { name: a.automation_name })
                    : a.automation_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DateRangePicker
          value={range}
          placeholder={t('contacts.filterPeriod')}
          onChange={(r) =>
            setFilters({
              from: r?.from ? format(r.from, 'yyyy-MM-dd') : null,
              to: r?.to
                ? format(r.to, 'yyyy-MM-dd')
                : r?.from
                  ? format(r.from, 'yyyy-MM-dd')
                  : null,
            })
          }
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('contacts.searchPlaceholder')}
          aria-label={t('contacts.searchPlaceholder')}
          style={{ width: 200 }}
        />
        <label className="flex items-center gap-2" style={{ fontSize: '0.85rem' }}>
          <Switch
            checked={filters.reachedOnly}
            onCheckedChange={(v) => setFilters({ reachedOnly: v })}
          />
          {t('contacts.reachedOnly')}
        </label>
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="outline" onClick={onExport} disabled={exporting || total === 0}>
            {exporting ? (
              <Spinner size="sm" />
            ) : (
              <Download className="h-4 w-4" style={{ marginRight: '0.5rem' }} />
            )}
            {exporting ? t('contacts.exporting') : t('contacts.export')}
          </Button>
        </div>
      </div>

      {listQuery.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : listQuery.isError ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {t('contacts.loadError')}
          </p>
          <Button variant="outline" onClick={() => listQuery.refetch()}>
            {t('contacts.retry')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
          {!hasAnyContact
            ? t('contacts.emptyNone')
            : onlyDefaultFilter
              ? t('contacts.emptyNoneReached')
              : t('contacts.emptyFiltered')}
        </p>
      ) : (
        <>
          <ContactsList
            rows={rows}
            clientesById={clientesById}
            showClient={filters.clientId == null}
            isDesktop={isDesktop}
          />
          <div
            className="flex items-center justify-between"
            style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}
          >
            <span>{t('contacts.showing', { from, to, total })}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('contacts.prev')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={to >= total}
                onClick={() => setPage(page + 1)}
              >
                {t('contacts.next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
