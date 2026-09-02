import SuasNotificacoesSection from './notificacoes/SuasNotificacoesSection';
// Task 8 adds a digest/resumo section here:
// import ResumoDiarioSection from './notificacoes/ResumoDiarioSection';
// Task 9 adds a channels/canais section here:
// import CanaisSection from './notificacoes/CanaisSection';

/** Central de Notificações: "Suas notificações" (esta task) + as seções das
 * Tasks 8-9, empilhadas nesta mesma aba. */
export default function NotificacoesTab() {
  return (
    <div className="max-w-3xl space-y-6">
      <SuasNotificacoesSection />
      {/* Task 8: <ResumoDiarioSection /> */}
      {/* Task 9: <CanaisSection /> */}
    </div>
  );
}
