import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { PageHeader } from '../../components/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import type { GlobalBanner } from '../../lib/api';
import { BannerPreview } from './BannerFormFields';
import {
  STATUS_FILTERS,
  TYPE_COLORS,
  TYPE_LABELS,
  formatSchedule,
  getStatusBadge,
  getTargetLabel,
} from './banner-form';
import type { BannersViewProps } from './BannersPhone';

function BannerRow({
  banner,
  plans,
  onEdit,
  onDelete,
}: {
  banner: GlobalBanner;
  plans: BannersViewProps['plans'];
  onEdit: (banner: GlobalBanner) => void;
  onDelete: (banner: GlobalBanner) => void;
}) {
  const tc = TYPE_COLORS[banner.type];
  const status = getStatusBadge(banner);
  const summary = banner.content.length > 40 ? `${banner.content.slice(0, 40)}…` : banner.content;
  return (
    <li className="flex flex-wrap items-center gap-4 border-t border-border/60 px-[18px] py-3.5 first:border-t-0">
      <div className={`min-w-0 flex-[1_1_380px] ${banner.status === 'draft' ? 'opacity-70' : ''}`}>
        <div className="mb-2 flex gap-1.5">
          <span
            className="rounded-[6px] px-[7px] py-px text-[11px] font-bold uppercase tracking-[0.02em]"
            style={{ color: tc.accent, backgroundColor: tc.bg }}
          >
            {TYPE_LABELS[banner.type]}
          </span>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <BannerPreview
          type={banner.type}
          content={banner.content}
          customColor={banner.custom_color || ''}
          link={banner.link || ''}
          dismissible={banner.dismissible}
        />
      </div>
      <dl className="m-0 grid flex-[0_1_260px] grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[13px]">
        <dt className="text-muted-foreground">Público</dt>
        <dd className="m-0">{getTargetLabel(banner, plans)}</dd>
        <dt className="text-muted-foreground">Período</dt>
        <dd className="m-0">{formatSchedule(banner)}</dd>
        <dt className="text-muted-foreground">Fechamentos</dt>
        <dd className="m-0">{banner.dismissal_count}</dd>
      </dl>
      <div className="flex gap-1.5">
        <Button
          variant="secondary"
          aria-label={`Editar: ${summary}`}
          onClick={() => onEdit(banner)}
        >
          Editar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label={`Mais ações: ${summary}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(banner)}>Editar</DropdownMenuItem>
            {banner.status === 'draft' && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDelete(banner)}
              >
                <Trash2 size={14} aria-hidden="true" />
                Excluir
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function BannersDesktop({
  banners,
  plans,
  isLoading,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  onCreate,
  onEdit,
  onDelete,
}: BannersViewProps) {
  return (
    <div>
      <PageHeader
        title="Banners"
        description="Avisos globais no topo do CRM"
        actions={
          <>
            <SegmentedControl
              aria-label="Filtrar banners"
              options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))}
              value={statusFilter}
              onChange={onStatusFilterChange}
            />
            <Button onClick={onCreate}>
              <Plus aria-hidden="true" /> Novo banner
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <Input
          type="search"
          aria-label="Buscar banners"
          placeholder="Buscar banners…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <GlassPanel flush>
        {isLoading ? (
          <p className="px-[18px] py-4 text-sm text-muted-foreground">Carregando…</p>
        ) : banners.length === 0 ? (
          <p className="px-[18px] py-4 text-sm text-muted-foreground">Nenhum banner encontrado.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {banners.map((b) => (
              <BannerRow key={b.id} banner={b} plans={plans} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}
