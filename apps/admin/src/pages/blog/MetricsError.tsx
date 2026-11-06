import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/button';

/** One inline line for a failed blog-metrics load, with a retry. A compact cousin of
 * ErrorState: it sits above the list and in place of Desempenho, so a failure is never read as
 * "zero views". */
export function MetricsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-[18px] py-3 text-sm"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <AlertTriangle size={15} className="shrink-0 text-destructive" aria-hidden="true" />
        <span>Não foi possível carregar as métricas.</span>
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}
