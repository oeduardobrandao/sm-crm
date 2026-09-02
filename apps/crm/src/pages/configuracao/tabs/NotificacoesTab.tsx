import { useAuth } from '@/context/AuthContext';
import SuasNotificacoesSection from './notificacoes/SuasNotificacoesSection';
import EmailsAutomaticosSection from './notificacoes/EmailsAutomaticosSection';
import SeusClientesSection from './notificacoes/SeusClientesSection';

/** Central de Notificações: "Suas notificações" + "E-mails automáticos" +
 * "Seus clientes" (esta task, só para owner/admin), empilhadas nesta aba. */
export default function NotificacoesTab() {
  const { workspaceRole } = useAuth();
  const isOwnerOrAdmin = workspaceRole === 'owner' || workspaceRole === 'admin';

  return (
    <div className="max-w-3xl space-y-6">
      <SuasNotificacoesSection />
      <EmailsAutomaticosSection />
      {isOwnerOrAdmin && <SeusClientesSection />}
    </div>
  );
}
