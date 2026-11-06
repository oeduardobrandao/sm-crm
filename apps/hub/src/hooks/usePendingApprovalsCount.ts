import { useQuery } from '@tanstack/react-query';
import { hubLinhasQuery, hubPostsQuery } from '../queries';

// Every enviado_cliente post is in the bounded shell, whatever its date. With the linha
// editorial flag on, each linha still waiting for the client's decision counts as one more.
export function usePendingApprovalsCount(token: string, featureLinha: boolean): number {
  const { data } = useQuery(hubPostsQuery(token));
  const { data: linhas } = useQuery({ ...hubLinhasQuery(token), enabled: featureLinha });
  const posts = (data?.posts ?? []).filter((p) => p.status === 'enviado_cliente').length;
  if (!featureLinha) return posts;
  return posts + (linhas?.linhas ?? []).filter((l) => l.status === 'enviada').length;
}
