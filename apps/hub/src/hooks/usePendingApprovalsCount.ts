import { useQuery } from '@tanstack/react-query';
import { fetchPosts } from '../api';

export function usePendingApprovalsCount(token: string): number {
  const { data } = useQuery({ queryKey: ['hub-posts', token], queryFn: () => fetchPosts(token) });
  return (data?.posts ?? []).filter((p) => p.status === 'enviado_cliente').length;
}
