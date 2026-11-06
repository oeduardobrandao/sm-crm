import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useHub } from '../../HubContext';
import { useStickyMaterialRequest } from '../../hooks/useOpenMaterialRequest';
import { hubMaterialRequestsQuery } from '../../queries';
import { MaterialRequestDialog } from '../../components/material/MaterialRequestDialog';
import { MaterialTile } from './MaterialTile';

/**
 * The Material section of Aprovações: one tile per open request, in the server's order. A tile
 * sets `?pedido=<postId>`; the request dialog opens for an open request with that id and stays
 * (marked closed) if a refetch drops it meanwhile. An unknown id, once loaded, is dropped.
 */
export function MaterialTab({ onOpen }: { onOpen: (postId: number) => void }) {
  const { t } = useTranslation('hubMaterial');
  const { token } = useHub();
  const { data, isLoading, isError } = useQuery(hubMaterialRequestsQuery(token));
  const [searchParams, setSearchParams] = useSearchParams();
  const pedidoParam = searchParams.get('pedido');
  const pedidoId = pedidoParam === null ? NaN : parseInt(pedidoParam, 10);
  const hasPedido = !isNaN(pedidoId);
  const live = hasPedido ? (data?.find((r) => r.post_id === pedidoId) ?? null) : null;
  const { entry, closed } = useStickyMaterialRequest(live, hasPedido ? pedidoId : null, hasPedido);
  const dropPedido = useCallback(
    () =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('pedido');
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  // A link to a request that is no longer open (or never was): nothing to show, so no param
  // left behind to pop the dialog later if that post gets a new request.
  const stale = pedidoParam !== null && data !== undefined && entry === null;
  useEffect(() => {
    if (stale) dropPedido();
  }, [stale, dropPedido]);
  const dialog = entry && (
    <MaterialRequestDialog
      token={token}
      entry={entry}
      closed={closed}
      open
      onOpenChange={(open) => {
        if (!open) dropPedido();
      }}
    />
  );

  if (isLoading) {
    return (
      <p role="status" className="text-sm hub-tx2">
        {t('carregando')}
      </p>
    );
  }
  if (data === undefined && isError) {
    return <p className="py-20 text-center text-sm hub-tx2">{t('erro')}</p>;
  }
  const requests = data ?? [];
  if (requests.length === 0) {
    return (
      <>
        <p className="text-sm hub-tx2">{t('vazio')}</p>
        {dialog}
      </>
    );
  }
  return (
    <>
      <div className="hub-fade-up grid grid-cols-2 gap-1 sm:grid-cols-3">
        {requests.map((r) => (
          <MaterialTile key={r.post_id} request={r} onOpen={onOpen} />
        ))}
      </div>
      {dialog}
    </>
  );
}
