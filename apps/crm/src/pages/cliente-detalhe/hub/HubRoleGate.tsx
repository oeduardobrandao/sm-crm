import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';

/**
 * As cinco rotas do portal têm `roles: ALL` de propósito: um `agent` chega na
 * URL e vê o aviso, em vez de ser redirecionado pelo guard. Este componente é
 * onde essa checagem mora, para não repetir o bloco cinco vezes.
 */
export function HubRoleGate({ children }: { children: ReactNode }) {
  const { workspaceRole } = useAuth();
  const { t } = useTranslation('clients');

  if (workspaceRole === 'agent') {
    return (
      <RoleRestrictionNotice
        title={t('detail.clientHubRestrictedTitle')}
        description={t('detail.clientHubRestrictedDesc')}
      />
    );
  }
  return <>{children}</>;
}
