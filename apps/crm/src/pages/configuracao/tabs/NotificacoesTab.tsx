import SuasNotificacoesSection from './notificacoes/SuasNotificacoesSection';
import EmailsAutomaticosSection from './notificacoes/EmailsAutomaticosSection';
// Task 9 adds a channels/canais section here:
// import CanaisSection from './notificacoes/CanaisSection';

/** Central de Notificações: "Suas notificações" + "E-mails automáticos"
 * (esta task) + a seção da Task 9, empilhadas nesta mesma aba. */
export default function NotificacoesTab() {
  return (
    <div className="max-w-3xl space-y-6">
      <SuasNotificacoesSection />
      <EmailsAutomaticosSection />
      {/* Task 9: <CanaisSection /> */}
    </div>
  );
}
