import { useQuery } from '@tanstack/react-query';
import { hubLinhasQuery, hubMaterialRequestsQuery, hubPostsQuery } from '../queries';

// Every enviado_cliente post is in the bounded shell, whatever its date. With the linha
// editorial flag on, each linha still waiting for the client's decision counts as one more,
// and so does each open material request (one per post).
export function usePendingApprovalsCount(token: string, featureLinha: boolean): number {
  const { data } = useQuery(hubPostsQuery(token));
  const { data: linhas } = useQuery({ ...hubLinhasQuery(token), enabled: featureLinha });
  const { data: material } = useQuery(hubMaterialRequestsQuery(token));
  const posts = (data?.posts ?? []).filter((p) => p.status === 'enviado_cliente').length;
  const requests = material?.length ?? 0;
  if (!featureLinha) return posts + requests;
  return posts + requests + (linhas?.linhas ?? []).filter((l) => l.status === 'enviada').length;
}
