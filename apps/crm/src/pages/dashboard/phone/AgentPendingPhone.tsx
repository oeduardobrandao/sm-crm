import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListSkeleton } from '@/components/ui/skeletons';
import { useAgentPending } from '../useAgentPending';
import { PhoneSection } from './PhoneSection';

/** Agents' "Minhas pendências" on phones: their open tasks as a grouped section. */
export function AgentPendingPhone() {
  const { t } = useTranslation('dashboard');
  const { membro, membroLoading, tarefasLoading, minhasTarefas, nothingPending, badgeOf } =
    useAgentPending();
  const title = t('agentPending.title', 'Minhas pendências');

  if (!membroLoading && !membro) return null;

  return (
    <PhoneSection
      title={title}
      data-testid="agent-pending-phone"
      trailing={
        minhasTarefas.length > 0 ? (
          <Link to="/tarefas" className="phone-home-link">
            {t('agentPending.verTodas', 'Ver todas')}
          </Link>
        ) : null
      }
    >
      {(membroLoading || tarefasLoading) && (
        <li className="phone-home-row phone-home-row--pad">
          <ListSkeleton rows={3} />
        </li>
      )}
      {!membroLoading && nothingPending && (
        <li className="phone-home-row phone-home-row--pad">
          <span className="phone-home-empty">
            {t('agentPending.vazio', 'Nenhuma tarefa atribuída a você.')}
          </span>
        </li>
      )}
      {minhasTarefas.map((task) => {
        const badge = badgeOf(task);
        return (
          <li key={task.id} className="phone-home-row">
            <Link to={`/tarefas?tarefa=${task.id}`} className="phone-home-row__link">
              <span className="phone-home-row__text">
                <span className="phone-home-row__title">{task.titulo}</span>
                {task.cliente_nome && (
                  <span className="phone-home-row__context">{task.cliente_nome}</span>
                )}
              </span>
              {badge && (
                <span className={`board-card-deadline phone-home-badge ${badge.className}`}>
                  {badge.label}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </PhoneSection>
  );
}
