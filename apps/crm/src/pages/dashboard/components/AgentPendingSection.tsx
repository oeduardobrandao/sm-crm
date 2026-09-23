import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { getTarefas, type TarefaWithRelations } from '../../../store';
import { useCurrentMembro } from '../../../hooks/useCurrentMembro';
import { dueBadge, sortTarefas } from '../../tarefas/tarefasLogic';

const MAX_ROWS = 8;

function SectionLabel({
  icon,
  children,
  to,
  linkLabel,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  to: string;
  linkLabel: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        marginBottom: '0.4rem',
      }}
    >
      <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{icon}</span>
      <span
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-muted)',
        }}
      >
        {children}
      </span>
      <Link
        to={to}
        style={{
          marginLeft: 'auto',
          fontSize: '0.7rem',
          fontWeight: 600,
          color: 'var(--text-light)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.2rem',
        }}
      >
        {linkLabel} <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function Row({
  to,
  title,
  context,
  badge,
}: {
  to: string;
  title: string;
  context?: string;
  badge?: { label: string; className: string } | null;
}) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.45rem 0.6rem',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        background: 'var(--card-bg)',
      }}
    >
      <span
        style={{
          fontSize: '0.8rem',
          fontWeight: 500,
          color: 'var(--text-main)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {context && (
        <span
          style={{
            fontSize: '0.68rem',
            color: 'var(--text-muted)',
            flexShrink: 0,
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {context}
        </span>
      )}
      {badge && (
        <span
          className={`board-card-deadline ${badge.className}`}
          style={{ marginLeft: 'auto', flexShrink: 0 }}
        >
          {badge.label}
        </span>
      )}
    </Link>
  );
}

/**
 * Agent dashboard: the open tasks assigned to the logged-in user's membro.
 * Etapas and posts moved to MinhaFilaCard (spec 2026-09-23 § Teaser), which
 * also owns the "vincule seu usuário" state, so this renders nothing without
 * a membro. Queries are component-local on purpose: DashboardPage's
 * useQueries batch is mocked by index in its test, so nothing may be appended
 * there.
 */
export function AgentPendingSection() {
  const { t } = useTranslation('dashboard');
  const { membro, isLoading: membroLoading } = useCurrentMembro();
  const membroId = membro?.id ?? null;

  const { data: tarefas = [], isLoading: tarefasLoading } = useQuery({
    queryKey: ['tarefas'],
    queryFn: getTarefas,
    enabled: membroId != null,
  });

  if (membroLoading) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderRadius: '12px' }}>
        <Spinner size="md" />
      </div>
    );
  }

  if (!membro) return null;

  const now = new Date();
  const minhasTarefas = tarefas
    .filter((task) => task.responsavel_id === membroId && task.status !== 'concluida')
    .sort(sortTarefas)
    .slice(0, MAX_ROWS);
  const nothingPending = !tarefasLoading && minhasTarefas.length === 0;
  const tarefaBadgeOf = (task: TarefaWithRelations) => dueBadge(task, now);

  return (
    <div className="card animate-up" style={{ padding: '1.25rem', borderRadius: '12px' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>
        {t('agentPending.title', 'Minhas pendências')}
      </h2>

      {tarefasLoading && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <Spinner size="md" />
        </div>
      )}

      {nothingPending && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {t('agentPending.vazio', 'Tudo em dia! Nenhuma pendência atribuída a você.')}
        </p>
      )}

      {minhasTarefas.length > 0 && (
        <div>
          <SectionLabel
            icon={<ClipboardList className="h-3.5 w-3.5" />}
            to="/tarefas"
            linkLabel={t('agentPending.verTodas', 'Ver todas')}
          >
            {t('agentPending.tarefas', 'Tarefas')}
          </SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {minhasTarefas.map((task) => (
              <Row
                key={task.id}
                to={`/tarefas?tarefa=${task.id}`}
                title={task.titulo}
                context={task.cliente_nome ?? undefined}
                badge={tarefaBadgeOf(task)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
