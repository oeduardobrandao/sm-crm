import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getAffiliate, updateAffiliateStatus } from '../lib/api';
import { affiliatesPath } from '../lib/routes';
import { useIsPhone } from '../hooks/useIsPhone';
import { ErrorState } from '../components/ErrorState';
import { AdminNavBar } from '../components/shell/AdminNavBar';
import { Skeleton } from '../components/ui/skeleton';
import { AffiliateDetailDesktop } from './affiliates/AffiliateDetailDesktop';
import { AffiliateDetailPhone } from './affiliates/AffiliateDetailPhone';
import type { HistoryTab } from './affiliates/affiliate-view';

export default function AffiliateDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();
  // Kept here so the tab survives crossing the 768px breakpoint.
  const [tab, setTab] = useState<HistoryTab>('comissoes');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'affiliate', id],
    queryFn: () => getAffiliate(id),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'affiliate', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'affiliates'] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'suspended') => updateAffiliateStatus(id, status),
    onSuccess: () => {
      invalidate();
      toast.success('Afiliado atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const nav = isPhone ? <AdminNavBar back={{ to: affiliatesPath(), label: 'Afiliados' }} /> : null;

  if (isError) {
    return (
      <>
        {nav}
        <ErrorState
          message="Não foi possível carregar o afiliado."
          onRetry={() => void refetch()}
        />
      </>
    );
  }
  if (isLoading || !data) {
    return (
      <>
        {nav}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  const view = {
    data,
    tab,
    onTabChange: setTab,
    onToggleStatus: () =>
      statusMutation.mutate(data.affiliate.status === 'active' ? 'suspended' : 'active'),
    statusPending: statusMutation.isPending,
  };
  return isPhone ? <AffiliateDetailPhone {...view} /> : <AffiliateDetailDesktop {...view} />;
}
