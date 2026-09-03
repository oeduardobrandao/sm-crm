import { useAuth } from '@/context/AuthContext';
import SuasNotificacoesSection from './notificacoes/SuasNotificacoesSection';
import EmailsAutomaticosSection from './notificacoes/EmailsAutomaticosSection';
import SeusClientesSection from './notificacoes/SeusClientesSection';

/** Central de Notificações: "Suas notificações" + "E-mails automáticos" +
 * "Seus clientes" (esta task, só para owner/admin), empilhadas nesta aba. */
export default function NotificacoesTab() {
  const { can } = useAuth();
  // The `configuracoes` tab itself is already gated on `configuracoes:ver`
  // at the tab layer (configTabs.ts, Task 12) -- mirrors that here. Was
  // `workspaceRole === 'owner' || workspaceRole === 'admin'`, which a custom
  // role with the chassis 'agent' role never passed even when it held the
  // tab-level grant.
  const canViewConfig = can('configuracoes', 'ver') === true;

  return (
    <div className="max-w-3xl space-y-6">
      <SuasNotificacoesSection />
      <EmailsAutomaticosSection />
      {canViewConfig && <SeusClientesSection />}
    </div>
  );
}
