// Phone drill-down for MCP keys and OAuth grants: a row that opens a sheet with the list.
import { useState, type ReactNode } from 'react';
import { BottomSheet, Cell, GroupedList } from '@mesaas/ios-kit';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import type { ConnectionsModel } from './types';

export interface ConnectionPhoneRow {
  id: string;
  label: ReactNode;
  scopes: string[];
  revoked: boolean;
}

export function ConnectionsPhone<T>({
  title,
  emptyText,
  model,
  toRow,
}: {
  title: string;
  emptyText: string;
  model: ConnectionsModel<T>;
  toRow: (item: T) => ConnectionPhoneRow;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Cell
        label={title}
        value={`${model.activeCount} ${model.activeCount === 1 ? 'ativa' : 'ativas'}`}
        chevron
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      <BottomSheet open={open} onOpenChange={setOpen} title={title}>
        {model.visible.length === 0 ? (
          <p className="mb-5 px-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <GroupedList aria-label={title}>
            {model.visible.map((item) => {
              const row = toRow(item);
              return (
                <Cell
                  key={row.id}
                  label={row.label}
                  subtitle={row.scopes.join(', ')}
                  accessory={
                    row.revoked ? (
                      <Badge variant="neutral">revogada</Badge>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => model.onRevoke(row.id)}
                        disabled={model.revokePending}
                      >
                        Revogar
                      </Button>
                    )
                  }
                />
              );
            })}
          </GroupedList>
        )}
        {(model.revokedCount > 0 || model.activeCount > 0) && (
          <GroupedList aria-label={`Ações: ${title}`}>
            {model.revokedCount > 0 && (
              <Cell
                label={
                  model.showRevoked
                    ? 'Ocultar revogadas'
                    : `Mostrar revogadas (${model.revokedCount})`
                }
                aria-pressed={model.showRevoked}
                onClick={model.onToggleRevoked}
              />
            )}
            {model.activeCount > 0 && (
              <Cell
                label="Revogar todas"
                destructive
                disabled={model.revokeAllPending}
                onClick={model.onRevokeAll}
              />
            )}
          </GroupedList>
        )}
      </BottomSheet>
    </>
  );
}
