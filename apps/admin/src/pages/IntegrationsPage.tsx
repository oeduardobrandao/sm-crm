import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listAdminMcpGrants, revokeAdminMcpGrant, type AdminMcpGrant } from '../lib/api';
import { useIsPhone } from '../hooks/useIsPhone';
import { IntegrationsDesktop } from './integrations/IntegrationsDesktop';
import { IntegrationsPhone } from './integrations/IntegrationsPhone';
import { CONNECTOR_URL } from './integrations/shared';

export default function IntegrationsPage() {
  const queryClient = useQueryClient();
  const isPhone = useIsPhone();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'admin-mcp-grants'],
    queryFn: listAdminMcpGrants,
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => revokeAdminMcpGrant(grantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admin-mcp-grants'] });
      toast.success('Conexão revogada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleRevoke = (grant: AdminMcpGrant) => {
    if (!window.confirm('Revogar esta conexão? O conector para de funcionar imediatamente.'))
      return;
    revokeMutation.mutate(grant.id);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL);
      toast.success('URL copiada');
    } catch {
      toast.error('Não foi possível copiar a URL');
    }
  };

  const view = {
    grants: data?.grants ?? [],
    isLoading,
    isError,
    onRetry: () => refetch(),
    onCopy: handleCopy,
    onRevoke: handleRevoke,
    revoking: revokeMutation.isPending,
  };

  return isPhone ? <IntegrationsPhone {...view} /> : <IntegrationsDesktop {...view} />;
}
