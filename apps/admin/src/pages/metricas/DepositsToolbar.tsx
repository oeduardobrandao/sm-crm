import { RefreshCw } from 'lucide-react';
import type { DepositsResponse } from '../../lib/api';
import { Button } from '../../components/ui/button';

/** Caption + "Atualizar", shared by the desktop and phone Depósitos views. */
export function DepositsToolbar({
  data,
  isError,
  isFetching,
  onRefresh,
}: {
  data: DepositsResponse | undefined;
  isError: boolean;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        Valores líquidos, já descontadas as taxas dos provedores.
        {data && !isError
          ? ` Atualizado ${new Date(data.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
          : ''}
      </p>
      <Button variant="secondary" size="sm" onClick={onRefresh} disabled={isFetching}>
        <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
        Atualizar
      </Button>
    </div>
  );
}
