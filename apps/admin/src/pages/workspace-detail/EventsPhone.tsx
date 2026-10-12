// Phone face of WorkspaceEventsCard: one row for the caller's GroupedList, opening a sheet with
// the type filter, the event list and paging. The query stays in the card.
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BottomSheet, Cell, GroupedList, PickerCell } from '@mesaas/ios-kit';
import type { WorkspaceEvent } from '../../lib/api';
import { FILTERABLE_TYPES } from '../workspace-events';
import { Button } from '../../components/ui/button';

export interface EventPhoneRow {
  evt: WorkspaceEvent;
  meta: { label: string };
  desc: string;
  timeAgo: string;
  Icon: LucideIcon;
}

export interface EventsPhoneProps {
  rows: EventPhoneRow[];
  total: number;
  isLoading: boolean;
  filterType: string;
  onFilterChange: (value: string) => void;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function EventsPhone(props: EventsPhoneProps) {
  const [open, setOpen] = useState(false);
  const { rows } = props;
  return (
    <>
      <Cell
        label="Histórico de eventos"
        value={props.isLoading ? undefined : String(props.total)}
        chevron
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        popOnUnmount
        title={`Histórico de eventos (${props.total})`}
      >
        <GroupedList aria-label="Filtro de eventos">
          <PickerCell<string>
            label="Tipo de evento"
            value={props.filterType === '' ? null : props.filterType}
            onChange={(v) => props.onFilterChange(v ?? '')}
            emptyOption={{ label: 'Todos os eventos' }}
            options={FILTERABLE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </GroupedList>
        {props.isLoading ? (
          <p className="px-4 text-sm text-muted-foreground">Carregando eventos…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">Nenhum evento encontrado</p>
        ) : (
          <GroupedList aria-label="Eventos">
            {rows.map(({ evt, meta, desc, timeAgo, Icon }) => {
              const actor = evt.actor_name ?? evt.actor_email;
              const subtitle = [actor, desc].filter(Boolean).join(' · ');
              return (
                <Cell
                  key={evt.id}
                  icon={<Icon aria-hidden="true" />}
                  label={meta.label}
                  subtitle={subtitle || undefined}
                  value={timeAgo}
                  title={new Date(evt.created_at).toLocaleString('pt-BR')}
                />
              );
            })}
          </GroupedList>
        )}
        {props.totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 pb-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={props.onPrev}
              disabled={props.page === 0}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              {props.page + 1} de {props.totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={props.onNext}
              disabled={props.page >= props.totalPages - 1}
            >
              Próximo
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
