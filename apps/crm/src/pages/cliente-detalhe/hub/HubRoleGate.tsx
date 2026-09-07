import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';

/**
 * As cinco rotas do portal têm `roles: ALL` de propósito: um `agent` chega na
 * URL e vê o aviso, em vez de ser redirecionado pelo guard. Este componente é
 * onde essa checagem mora, para não repetir o bloco cinco vezes.
 *
 * `useHubRoleRestricted` existe para que as páginas também possam desligar
 * (`enabled: false`) as próprias queries — `hub-token`, `hub-brand-crm`,
 * `hub-pages-crm` — quando o papel é restrito, em vez de buscar o dado que o
 * gate existe para esconder e só então descartar o resultado no render.
 * `HubRoleGate` continua sendo o único lugar que define o que é "restrito".
 */
export function useHubRoleRestricted(): boolean {
  const { workspaceRole } = useAuth();
  return workspaceRole === 'agent';
}

export function HubRoleGate({ children }: { children: ReactNode }) {
  const isRestricted = useHubRoleRestricted();
  const { t } = useTranslation('clients');

  if (isRestricted) {
    return (
      <RoleRestrictionNotice
        title={t('detail.clientHubRestrictedTitle')}
        description={t('detail.clientHubRestrictedDesc')}
      />
    );
  }
  return <>{children}</>;
}
