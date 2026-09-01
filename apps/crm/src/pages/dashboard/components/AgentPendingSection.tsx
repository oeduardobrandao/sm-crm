import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ClipboardList, Kanban, Send } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import {
  getAllActiveEtapas,
  getAssignedPendingPosts,
  getDeadlineInfo,
  getTarefas,
  type TarefaWithRelations,
} from '../../../store';
import { useCurrentMembro } from '../../../hooks/useCurrentMembro';
import { dueBadge, sortTarefas } from '../../tarefas/tarefasLogic';
import { STATUS_LABELS as POST_STATUS_LABELS } from '../../entregas/postLabels';

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
 * Agent dashboard: everything pending for the logged-in user's membro — open
 * tasks, active workflow steps, and pending posts assigned to them. Queries are
 * component-local on purpose: DashboardPage's useQueries batch is mocked by
 * index in its test, so nothing may be appended there.
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
  const { data: etapas = [], isLoading: etapasLoading } = useQuery({
    queryKey: ['agent-pending-etapas'],
    queryFn: getAllActiveEtapas,
    enabled: membroId != null,
  });
  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ['agent-pending-posts', membroId],
    queryFn: () => getAssignedPendingPosts(membroId!),
    enabled: membroId != null,
  });

  if (membroLoading) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderRadius: '12px' }}>
        <Spinner size="md" />
      </div>
    );
  }

  if (!membro) {
    return (
      <div
        className="card animate-up"
        style={{ padding: '1.5rem', borderRadius: '12px', color: 'var(--text-muted)' }}
      >
        <h2 style={{ fontSize: '1rem', marginBottom: '0.4rem', color: 'var(--text-main)' }}>
          {t('agentPending.title', 'Minhas pendências')}
        </h2>
        <p style={{ fontSize: '0.82rem' }}>
          {t(
            'agentPending.semVinculo',
            'Seu usuário ainda não está vinculado a um membro da equipe. Peça a um administrador para fazer o vínculo na página Equipe.',
          )}
        </p>
      </div>
    );
  }

  const now = new Date();
  const minhasTarefas = tarefas
    .filter((task) => task.responsavel_id === membroId && task.status !== 'concluida')
    .sort(sortTarefas)
    .slice(0, MAX_ROWS);
  const minhasEtapas = etapas
    .filter((e) => e.responsavel_id === membroId && e.status === 'ativo')
    .slice(0, MAX_ROWS);
  const meusPosts = posts.slice(0, MAX_ROWS);

  const isLoading = tarefasLoading || etapasLoading || postsLoading;
  const nothingPending =
    !isLoading && minhasTarefas.length === 0 && minhasEtapas.length === 0 && meusPosts.length === 0;

  const etapaBadge = (etapa: (typeof minhasEtapas)[number]) => {
    const info = getDeadlineInfo(etapa);
    if (info.estourado) return { label: 'Atrasada', className: 'deadline-overdue' };
    if (info.urgente) return { label: 'Urgente', className: 'deadline-warning' };
    return { label: `${info.diasRestantes}d`, className: 'deadline-ok' };
  };

  const tarefaBadgeOf = (task: TarefaWithRelations) => dueBadge(task, now);

  return (
    <div className="card animate-up" style={{ padding: '1.25rem', borderRadius: '12px' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>
        {t('agentPending.title', 'Minhas pendências')}
      </h2>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <Spinner size="md" />
        </div>
      )}

      {nothingPending && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {t('agentPending.vazio', 'Tudo em dia! Nenhuma pendência atribuída a você.')}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
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

        {minhasEtapas.length > 0 && (
          <div>
            <SectionLabel
              icon={<Kanban className="h-3.5 w-3.5" />}
              to="/entregas"
              linkLabel={t('agentPending.verEntregas', 'Ver entregas')}
            >
              {t('agentPending.etapas', 'Entregas · etapas')}
            </SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {minhasEtapas.map((etapa) => (
                <Row
                  key={etapa.id}
                  to={`/entregas?drawer=${etapa.workflow_id}`}
                  title={etapa.nome}
                  context={[etapa.workflow_titulo, etapa.cliente_nome].filter(Boolean).join(' · ')}
                  badge={etapaBadge(etapa)}
                />
              ))}
            </div>
          </div>
        )}

        {meusPosts.length > 0 && (
          <div>
            <SectionLabel
              icon={<Send className="h-3.5 w-3.5" />}
              to="/entregas"
              linkLabel={t('agentPending.verEntregas', 'Ver entregas')}
            >
              {t('agentPending.posts', 'Entregas · posts')}
            </SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {meusPosts.map((post) => (
                <Row
                  key={post.id}
                  // NULL workflow_id = post avulso (fora de fluxo); it still opens via
                  // the universal ?post= deep-link form.
                  to={
                    post.workflow_id != null
                      ? `/entregas?drawer=${post.workflow_id}&post=${post.id}`
                      : `/entregas?post=${post.id}`
                  }
                  title={post.titulo}
                  context={[post.cliente_nome, POST_STATUS_LABELS[post.status]]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
