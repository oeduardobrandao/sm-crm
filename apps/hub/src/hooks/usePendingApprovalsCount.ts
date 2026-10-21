import { useQuery } from '@tanstack/react-query';
import { hubPostsQuery } from '../queries';

// Every enviado_cliente post is in the bounded shell, whatever its date.
export function usePendingApprovalsCount(token: string): number {
  const { data } = useQuery(hubPostsQuery(token));
  return (data?.posts ?? []).filter((p) => p.status === 'enviado_cliente').length;
}
