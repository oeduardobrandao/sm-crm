import { useState } from 'react';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { GroupedList, PhoneIconButton, SegmentedControl } from '@mesaas/ios-kit';
import { PageHeader } from '../../components/PageHeader';
import { Badge } from '../../components/ui/badge';
import type { GlobalBanner } from '../../lib/api';
import {
  STATUS_FILTERS,
  TYPE_COLORS,
  TYPE_LABELS,
  formatSchedule,
  getStatusBadge,
  getTargetLabel,
} from './banner-form';

export interface BannersViewProps {
  banners: GlobalBanner[];
  plans: { id: string; name: string }[] | undefined;
  isLoading: boolean;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onEdit: (banner: GlobalBanner) => void;
  onDelete: (banner: GlobalBanner) => void;
}

function BannerRow({
  banner,
  plans,
  onEdit,
}: {
  banner: GlobalBanner;
  plans: BannersViewProps['plans'];
  onEdit: (banner: GlobalBanner) => void;
}) {
  const tc = TYPE_COLORS[banner.type];
  const status = getStatusBadge(banner);
  return (
    <li className="phone-cell">
      <button
        type="button"
        className={`phone-cell__main ${banner.status === 'draft' ? 'opacity-60' : ''}`}
        onClick={() => onEdit(banner)}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="mb-1 flex gap-1.5">
            <span
              className="rounded-[6px] px-[7px] py-px text-[11px] font-bold uppercase"
              style={{ color: tc.accent, backgroundColor: tc.bg }}
            >
              {TYPE_LABELS[banner.type]}
            </span>
            <Badge variant={status.tone}>{status.label}</Badge>
          </span>
          <span className="line-clamp-2 block text-[15px] leading-[1.35]">{banner.content}</span>
          <span className="mt-1 block text-[13px] text-muted-foreground">
            {getTargetLabel(banner, plans)} · {formatSchedule(banner)}
          </span>
        </span>
        <ChevronRight className="phone-cell__chevron" aria-hidden="true" />
      </button>
    </li>
  );
}

export function BannersPhone({
  banners,
  plans,
  isLoading,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  onCreate,
  onEdit,
}: BannersViewProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = searchOpen || search !== '';

  return (
    <div className="phone-kit">
      <PageHeader
        title="Banners"
        description="Gerencie os avisos globais"
        phoneActions={
          <>
            <PhoneIconButton label="Buscar banners" onClick={() => setSearchOpen((v) => !v)}>
              <Search aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton label="Novo banner" variant="ink" onClick={onCreate}>
              <Plus aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
      >
        <SegmentedControl
          aria-label="Status"
          options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))}
          value={statusFilter}
          onChange={onStatusFilterChange}
        />
      </PageHeader>

      {showSearch && (
        <input
          type="search"
          aria-label="Buscar banners"
          placeholder="Buscar banners…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="mb-4 h-10 w-full rounded-[10px] border-0 bg-secondary px-3 text-[17px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      )}

      {isLoading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : banners.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nenhum banner encontrado.</p>
      ) : (
        <GroupedList aria-label="Banners">
          {banners.map((b) => (
            <BannerRow key={b.id} banner={b} plans={plans} onEdit={onEdit} />
          ))}
        </GroupedList>
      )}
    </div>
  );
}
