import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useHub } from '../../HubContext';
import { hubMaterialRequestsQuery } from '../../queries';
import { MaterialTile } from './MaterialTile';

/** The Material section of Aprovações: one tile per open request, in the server's order. */
export function MaterialTab({ onOpen }: { onOpen: (postId: number) => void }) {
  const { t } = useTranslation('hubMaterial');
  const { token } = useHub();
  const { data, isLoading, isError } = useQuery(hubMaterialRequestsQuery(token));

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
    <div className="hub-fade-up grid grid-cols-2 gap-1 sm:grid-cols-3">
      {requests.map((r) => (
        <MaterialTile key={r.post_id} request={r} onOpen={onOpen} />
      ))}
    </div>
  );
}
