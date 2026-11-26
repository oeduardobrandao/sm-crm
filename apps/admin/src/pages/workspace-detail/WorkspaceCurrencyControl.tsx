import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SegmentedControl } from '@mesaas/ios-kit';
import { setWorkspaceCurrency, type AdminApiError } from '../../lib/api';

type Currency = 'brl' | 'usd';

export const CURRENCY_LOCKED_HINT = 'Travada após o primeiro checkout';

/**
 * "Moeda de cobrança" of the workspace. The server refuses the change once the workspace has
 * checked out (409 currency_locked): the switch then locks with a hint until the page reloads.
 */
export function WorkspaceCurrencyControl({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: Currency;
}) {
  const qc = useQueryClient();
  const [locked, setLocked] = useState(false);
  const mutation = useMutation({
    mutationFn: (next: Currency) => setWorkspaceCurrency(workspaceId, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'workspace', workspaceId] });
      toast.success('Moeda de cobrança atualizada');
    },
    onError: (err) => {
      if ((err as AdminApiError).status === 409) {
        setLocked(true);
        toast.error(CURRENCY_LOCKED_HINT);
      } else {
        toast.error('Não foi possível alterar a moeda.');
      }
    },
  });

  // Navigating to another workspace resets the lock (it only reruns when workspaceId changes).
  useEffect(() => setLocked(false), [workspaceId]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">Moeda de cobrança</span>
      <SegmentedControl<Currency>
        aria-label="Moeda de cobrança"
        value={currency}
        onChange={(next) => {
          if (next !== currency && !locked) mutation.mutate(next);
        }}
        options={[
          { value: 'brl', label: 'BRL', disabled: locked || mutation.isPending },
          { value: 'usd', label: 'USD', disabled: locked || mutation.isPending },
        ]}
      />
      {locked ? (
        <span role="status" className="text-xs text-muted-foreground">
          {CURRENCY_LOCKED_HINT}
        </span>
      ) : null}
    </div>
  );
}
