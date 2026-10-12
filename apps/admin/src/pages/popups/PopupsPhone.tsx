import { useState } from 'react';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { GroupedList, PhoneIconButton, SegmentedControl } from '@mesaas/ios-kit';
import { PageHeader } from '../../components/PageHeader';
import { Badge } from '../../components/ui/badge';
import { PageThumb } from './PageThumb';
import {
  PAGE_DESCRIPTION,
  STATUS_FILTERS,
  type PopupRowView,
  type PopupsViewProps,
} from './list-model';

function PopupRow({ row, onEdit }: { row: PopupRowView; onEdit: PopupsViewProps['onEdit'] }) {
  return (
    <li className="phone-cell">
      <button
        type="button"
        className={`phone-cell__main items-start gap-3 py-3 ${row.draft ? 'opacity-50' : ''}`}
        onClick={() => onEdit(row.popup)}
      >
        <PageThumb imageKey={row.imageKey} className="mt-0.5 h-[41px] w-[72px]" />
        <span className="min-w-0 flex-1 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[17px]">{row.title}</span>
            {row.pageCount > 1 && (
              <span className="shrink-0 rounded-[6px] bg-foreground/[0.12] px-1.5 text-[11px] font-semibold">
                {row.pagesLabel}
              </span>
            )}
          </span>
          <span className="block text-[13px] text-muted-foreground">
            {row.frequency} · {row.target}
          </span>
          <span className="block text-xs tabular-nums text-muted-foreground">{row.metrics}</span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant={row.status.variant}>{row.status.label}</Badge>
            {row.trigger && (
              <Badge variant="warning" className="normal-case tracking-normal">
                {row.trigger}
              </Badge>
            )}
          </span>
        </span>
        <ChevronRight className="phone-cell__chevron self-center" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Lista de popups no iPhone (board Popups): título grande, segmentado de status e lista. */
export function PopupsPhone({
  rows,
  isLoading,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  onCreate,
  onEdit,
}: PopupsViewProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = searchOpen || search !== '';

  return (
    <div className="phone-kit">
      <PageHeader
        title="Popups"
        description={PAGE_DESCRIPTION}
        phoneActions={
          <>
            <PhoneIconButton label="Buscar popups" onClick={() => setSearchOpen((v) => !v)}>
              <Search aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton label="Novo popup" variant="ink" onClick={onCreate}>
              <Plus aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
      >
        <SegmentedControl
          aria-label="Status"
          options={STATUS_FILTERS.map((s) =>
            s.value === 'archived' ? { ...s, label: 'Arquivo' } : s,
          )}
          value={statusFilter}
          onChange={onStatusFilterChange}
        />
      </PageHeader>

      {showSearch && (
        <input
          type="search"
          aria-label="Buscar popups"
          placeholder="Buscar popups…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="mb-4 h-10 w-full rounded-[10px] border-0 bg-secondary px-3 text-[17px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      )}

      {isLoading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nenhum popup encontrado.</p>
      ) : (
        <GroupedList aria-label="Popups">
          {rows.map((r) => (
            <PopupRow key={r.popup.id} row={r} onEdit={onEdit} />
          ))}
        </GroupedList>
      )}
    </div>
  );
}
