import { useMemo, useState } from 'react';
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
  // Custom dates being typed live here; the URL only ever holds a valid range.
  const [customOpen, setCustomOpen] = useState(filters.preset === 'custom');
  const [customStart, setCustomStart] = useState(filters.preset === 'custom' ? filters.start : '');
  const [customEnd, setCustomEnd] = useState(filters.preset === 'custom' ? filters.end : '');
  const customError = customOpen ? validateCustomRange(customStart, customEnd) : null;
  const q = useEmailList(filters);

  const update = (patch: Partial<ListFilters>) => {
    setSp(listFiltersToSearch({ ...filters, ...patch }));
  };

  const changePreset = (p: ListPreset) => {
    if (p === 'custom') {
      setCustomOpen(true);
      setCustomStart(filters.start);
      setCustomEnd(filters.end);
      update({ preset: 'custom' });
    } else {
      setCustomOpen(false);
      update({ preset: p, ...presetRange(p, new Date()) });
    }
  };

  const setCustom = (key: 'start' | 'end', value: string) => {
    const start = key === 'start' ? value : customStart;
    const end = key === 'end' ? value : customEnd;
    setCustomStart(start);
    setCustomEnd(end);
    if (validateCustomRange(start, end) === null) update({ preset: 'custom', start, end });
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

  const activePreset: ListPreset = customOpen ? 'custom' : filters.preset;

  const segments = (
    <SegmentedControl
      aria-label="Período"
      value={activePreset}
      onChange={changePreset}
      options={SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
    />
  );

  let body;
  if (q.isPending) {
    body = <Skeleton className="h-80 w-full rounded-2xl" />;
  } else if (q.isError && q.items.length === 0) {
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
          {q.isFetchNextPageError ? (
            <span role="alert" className="text-sm text-destructive">
              Não foi possível carregar mais.
            </span>
          ) : null}
          {q.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              {q.isFetchNextPageError ? 'Tentar de novo' : 'Carregar mais'}
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
      {customOpen ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Data inicial"
            className="w-auto"
            value={customStart}
            onChange={(e) => setCustom('start', e.target.value)}
          />
          <Input
            type="date"
            aria-label="Data final"
            className="w-auto"
            value={customEnd}
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
          onChange={(categories) => {
            const types = categories.length
              ? filters.types.filter((t) =>
                  q.types.some((x) => x.type === t && categories.includes(x.category)),
                )
              : filters.types;
            update({ categories, types });
          }}
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
