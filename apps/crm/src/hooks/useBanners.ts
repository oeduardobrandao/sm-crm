import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getActiveBanners, getDismissedBannerIds, dismissBanner, type GlobalBanner } from '../store';

const BANNERS_KEY = ['banners'] as const;
const DISMISSED_KEY = ['banner-dismissals'] as const;

const TYPE_PRIORITY: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export function useBanners() {
  const queryClient = useQueryClient();

  const bannersQuery = useQuery({
    queryKey: BANNERS_KEY,
    queryFn: getActiveBanners,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const dismissedQuery = useQuery({
    queryKey: DISMISSED_KEY,
    queryFn: getDismissedBannerIds,
    staleTime: 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: dismissBanner,
    onMutate: async (bannerId) => {
      await queryClient.cancelQueries({ queryKey: DISMISSED_KEY });
      const prev = queryClient.getQueryData<string[]>(DISMISSED_KEY);
      queryClient.setQueryData<string[]>(DISMISSED_KEY, (old) => [...(old || []), bannerId]);
      return { prev };
    },
    onError: (_err, _bannerId, context) => {
      if (context?.prev) queryClient.setQueryData(DISMISSED_KEY, context.prev);
      toast.error('Failed to dismiss banner');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DISMISSED_KEY });
    },
  });

  const dismissed = new Set(dismissedQuery.data || []);
  const visibleBanners = (bannersQuery.data || [])
    .filter((b) => !dismissed.has(b.id))
    .sort((a, b) => {
      const pa = TYPE_PRIORITY[a.type] ?? 9;
      const pb = TYPE_PRIORITY[b.type] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return {
    banners: visibleBanners,
    dismiss: (id: string) => dismissMutation.mutate(id),
    isLoading: bannersQuery.isLoading,
  };
}
