import { Plus } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { PageHeader } from '../../components/PageHeader';
import { RowButton } from '../../components/RowLink';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { PageThumb } from './PageThumb';
import { PAGE_DESCRIPTION, STATUS_FILTERS, type PopupsViewProps } from './list-model';

/** Lista de popups no desktop: segmentado de status, busca e tabela num painel de vidro. */
export function PopupsDesktop({
  rows,
  isLoading,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  onCreate,
  onEdit,
}: PopupsViewProps) {
  return (
    <div>
      <PageHeader
        title="Popups"
        description={PAGE_DESCRIPTION}
        actions={
          <>
            <SegmentedControl
              aria-label="Filtrar popups"
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={onStatusFilterChange}
            />
            <Button onClick={onCreate}>
              <Plus aria-hidden="true" /> Novo popup
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <Input
          type="search"
          aria-label="Buscar popups"
          placeholder="Buscar popups…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <GlassPanel flush>
        {isLoading ? (
          <p className="px-[18px] py-4 text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="px-[18px] py-4 text-sm text-muted-foreground">Nenhum popup encontrado.</p>
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Popup</TableHead>
                <TableHead>Páginas</TableHead>
                <TableHead>Público</TableHead>
                <TableHead>Frequência</TableHead>
                <TableHead>Agendamento</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.popup.id}
                  onClick={() => onEdit(r.popup)}
                  // Drafts mute their text (token, 4.5:1) instead of fading the whole row.
                  className={`cursor-pointer ${r.draft ? 'text-muted-foreground' : ''}`}
                >
                  <TableCell>
                    <div className="flex min-w-0 max-w-[16rem] items-center gap-3">
                      <PageThumb imageKey={r.imageKey} className="h-[27px] w-12 shrink-0" />
                      <div className="min-w-0">
                        <RowButton
                          onClick={() => onEdit(r.popup)}
                          className={`block max-w-full truncate text-sm font-medium ${r.draft ? 'text-muted-foreground' : ''}`}
                          title={r.title}
                        >
                          {r.title}
                        </RowButton>
                        <div
                          className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground"
                          title={r.metrics}
                        >
                          {r.metrics}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.pagesLabel}
                  </TableCell>
                  <TableCell className="max-w-[10rem]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{r.target}</span>
                      {r.trigger && (
                        <Badge variant="warning" className="normal-case tracking-normal">
                          {r.trigger}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[10rem]">{r.frequency}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.schedule}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={r.status.variant}>{r.status.label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassPanel>
    </div>
  );
}
