import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useHub } from '../../HubContext';
import { hubMaterialRequestsQuery } from '../../queries';
import { MaterialRequestDialog } from '../../components/material/MaterialRequestDialog';
import { MaterialTile } from './MaterialTile';

/**
 * The Material section of Aprovações: one tile per open request, in the server's order. A tile
 * sets `?pedido=<postId>`; the request dialog shows while that id is one of the open requests.
 */
export function MaterialTab({ onOpen }: { onOpen: (postId: number) => void }) {
  const { t } = useTranslation('hubMaterial');
  const { token } = useHub();
  const { data, isLoading, isError } = useQuery(hubMaterialRequestsQuery(token));
  const [searchParams, setSearchParams] = useSearchParams();
  const pedidoParam = searchParams.get('pedido');
  const pedidoId = pedidoParam === null ? NaN : parseInt(pedidoParam, 10);
  const openEntry = isNaN(pedidoId) ? null : (data?.find((r) => r.post_id === pedidoId) ?? null);
  const closeDialog = (open: boolean) => {
    if (open) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('pedido');
        return next;
      },
      { replace: true },
    );
  };
  const dialog = openEntry && (
    <MaterialRequestDialog token={token} entry={openEntry} open onOpenChange={closeDialog} />
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
  if (requests.length === 0) return <p className="text-sm hub-tx2">{t('vazio')}</p>;
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
