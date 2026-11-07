import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Mail } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { GlassPanel } from '../components/shell/GlassPanel';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { useIsPhone } from '../hooks/useIsPhone';
import { EmailsListPhone } from './emails/EmailsListPhone';
import { EmailsListTable } from './emails/EmailsListTable';
import {
  STATUS_GROUPS,
  listFiltersToSearch,
  parseListSearch,
  type ListFilters,
  type ListPreset,
} from './emails/email-list-view';
import {
  EMAIL_CATEGORY_LABELS,
  presetRange,
  typeLabel,
  validateCustomRange,
} from './emails/email-metrics-view';
import { useEmailList } from './emails/useEmailList';

const SEGMENTS: { value: ListPreset; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: 'custom', label: 'Personalizado' },
];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
          {label}
          {selected.length ? ` (${selected.length})` : ''}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onChange(toggle(selected, o.value))}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Todos os e-mails: full send list from `email_sends`, filters in the URL. */
export default function EmailsListPage() {
  const isPhone = useIsPhone();
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => parseListSearch(sp, new Date()), [sp]);
  // Raw custom dates the user is typing: the URL only keeps valid ranges.
  const rawStart = sp.get('start') ?? '';
  const rawEnd = sp.get('end') ?? '';
  const customRequested = sp.get('preset') === 'custom';
  const customError = customRequested ? validateCustomRange(rawStart, rawEnd) : null;
  const q = useEmailList(filters, customError === null);

  const update = (patch: Partial<ListFilters>) => {
    const next = { ...filters, ...patch };
    setSp(listFiltersToSearch(next));
  };

  const changePreset = (p: ListPreset) => {
    if (p === 'custom') {
      const r = presetRange('7d', new Date());
      const next = new URLSearchParams(listFiltersToSearch({ ...filters, preset: 'custom', ...r }));
      setSp(next);
    } else {
      update({ preset: p, ...presetRange(p, new Date()) });
    }
  };

  const setCustom = (key: 'start' | 'end', value: string) => {
    const next = new URLSearchParams(sp);
    next.set('preset', 'custom');
    next.set('start', key === 'start' ? value : rawStart);
    next.set('end', key === 'end' ? value : rawEnd);
    setSp(next);
  };

  const hasFilters =
    filters.categories.length > 0 || filters.types.length > 0 || filters.statuses.length > 0;
  const clear = () => update({ categories: [], types: [], statuses: [] });

  const typeOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const t of q.types) {
      if (filters.categories.length && !filters.categories.includes(t.category)) continue;
      if (seen.has(t.type)) continue;
      seen.add(t.type);
      out.push({ value: t.type, label: typeLabel(t.type) });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [q.types, filters.categories]);

  const activePreset: ListPreset = customRequested ? 'custom' : filters.preset;

  const segments = (
    <SegmentedControl
      aria-label="Período"
      value={activePreset}
      onChange={changePreset}
      options={SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
    />
  );

  let body;
  if (customError) {
    body = null;
  } else if (q.isPending) {
    body = <Skeleton className="h-80 w-full rounded-2xl" />;
  } else if (q.isError) {
    body = (
      <GlassPanel flush>
        <ErrorState message="Não foi possível carregar a lista." onRetry={() => q.refetch()} />
      </GlassPanel>
    );
  } else if (q.items.length === 0) {
    body = (
      <GlassPanel flush>
        <EmptyState
          icon={Mail}
          title="Nenhum e-mail com esses filtros"
          action={
            <Button variant="outline" size="sm" onClick={clear}>
              Limpar filtros
            </Button>
          }
        />
      </GlassPanel>
    );
  } else {
    body = (
      <>
        <GlassPanel flush>
          {isPhone ? <EmailsListPhone items={q.items} /> : <EmailsListTable items={q.items} />}
        </GlassPanel>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <span className="text-sm text-muted-foreground">
            {q.items.length.toLocaleString('pt-BR')} e-mails carregados
          </span>
          {q.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              Carregar mais
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Todos os e-mails"
        description="Todos os envios do período, do mais novo para o mais antigo"
        back={{ to: '/admin/emails', label: 'E-mails' }}
        actions={segments}
      >
        {isPhone ? segments : null}
      </PageHeader>
      {customRequested ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Data inicial"
            className="w-auto"
            value={rawStart}
            onChange={(e) => setCustom('start', e.target.value)}
          />
          <Input
            type="date"
            aria-label="Data final"
            className="w-auto"
            value={rawEnd}
            onChange={(e) => setCustom('end', e.target.value)}
          />
          {customError ? (
            <p role="alert" className="text-sm text-destructive">
              {customError}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <MultiSelect
          label="Categoria"
          options={Object.entries(EMAIL_CATEGORY_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
          selected={filters.categories}
          onChange={(categories) => update({ categories })}
        />
        <MultiSelect
          label="Tipo"
          options={typeOptions}
          selected={filters.types}
          onChange={(types) => update({ types })}
        />
        <MultiSelect
          label="Status"
          options={STATUS_GROUPS.map((g) => ({ value: g.key, label: g.label }))}
          selected={filters.statuses}
          onChange={(statuses) => update({ statuses: statuses as ListFilters['statuses'] })}
        />
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Limpar filtros
          </Button>
        ) : null}
      </div>
      {body}
    </div>
  );
}
