import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { MediaUnavailable } from '@/components/MediaUnavailable';
import { avatarColorClass } from '@/lib/avatarColor';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { PostEntity } from '../boardEntity';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from './PostStatusChip';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const deadlineAccent: Record<string, string> = {
  'deadline-ok': '#3ecf8e',
  'deadline-caution': '#eab308',
  'deadline-warning': '#ea580c',
  'deadline-overdue': '#ef4444',
};

interface PostProcessCardProps {
  entity: PostEntity;
  onClick?: () => void;
  isDragOverlay?: boolean;
}

/**
 * Card de um post individual no quadro de Fluxos (spec §4.2): cliente, título,
 * formato, tag "Individual", status do post (PostStatusChip, os mesmos rótulos
 * de Publicações), responsável e prazo da etapa, etapa e progresso, capa
 * quando existe. Fase 3 = leitura: SEM alça de arrastar e SEM botões de
 * avançar/voltar (fase 4). A marcação espelha WorkflowCard para que os dois
 * tipos fiquem visualmente na mesma família; o tipo é identificado por texto e
 * ícone, a cor é complementar.
 */
export function PostProcessCard({ entity, onClick, isDragOverlay }: PostProcessCardProps) {
  const navigate = useNavigate();
  const registry = useStatusRegistry();
  const dl = entity.deadline;
  const deadlineClass = dl.estourado
    ? 'deadline-overdue'
    : dl.urgente
      ? 'deadline-warning'
      : dl.diasRestantes <= 3
        ? 'deadline-caution'
        : 'deadline-ok';
  const hasDeadline = entity.prazoEfetivo != null;
  const deadlineText = !hasDeadline
    ? 'Sem prazo'
    : dl.estourado
      ? `${Math.abs(dl.diasRestantes)}d atrasado`
      : dl.diasRestantes === 0 && dl.horasRestantes === 0
        ? 'Vence agora'
        : dl.diasRestantes === 0
          ? `${dl.horasRestantes}h restantes`
          : dl.horasRestantes > 0
            ? `${dl.diasRestantes}d ${dl.horasRestantes}h restantes`
            : `${dl.diasRestantes}d restantes`;
  const etapaIdx = entity.steps.findIndex((s) => s.ordem === entity.etapaOrdem);
  const total = entity.steps.length;
  const progressPct = total > 0 && etapaIdx >= 0 ? Math.round((etapaIdx / total) * 100) : 0;
  const accent = hasDeadline ? (deadlineAccent[deadlineClass] ?? '#3ecf8e') : '#3ecf8e';
  const post = entity.process.post;
  const cliente = entity.cliente;

  return (
    <div
      className={`board-card board-card--post ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
      data-testid="post-process-card"
      style={{
        opacity: isDragOverlay ? 0.85 : 1,
        position: 'relative',
        padding: '0.9rem',
        gap: '0.6rem',
        borderRadius: '10px',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          className="board-card-client"
          style={{
            borderLeft: 'none',
            paddingLeft: 0,
            fontSize: '0.74rem',
            fontWeight: 500,
            textTransform: 'none',
            color: 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          {cliente ? (
            <>
              {entity.clienteAvatarUrl ? (
                <img
                  src={entity.clienteAvatarUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: cliente.cor || 'var(--surface-hover)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.45rem',
                    fontWeight: 800,
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {getInitials(cliente.nome)}
                </div>
              )}
              <span
                role="link"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/clientes/${cliente.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    navigate(`/clientes/${cliente.id}`);
                  }
                }}
                style={{
                  cursor: 'pointer',
                  color: cliente.cor || 'var(--text-muted)',
                  opacity: 0.85,
                }}
              >
                {cliente.nome}
              </span>
            </>
          ) : (
            post.cliente_nome || '—'
          )}
        </span>
        <span className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual">
          <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
          Individual
        </span>
      </div>

      <div
        className="board-card-title"
        style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.35, color: 'var(--text-main)' }}
      >
        {entity.titulo || 'Post sem título'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          {TIPO_LABELS[post.tipo]}
        </span>
        <PostStatusChip post={post} registry={registry} />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span
          className={`board-card-deadline ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
          }}
        >
          {deadlineText}
        </span>
        {entity.step.tipo_prazo && (
          <span
            className="board-card-prazo-type"
            style={{
              fontSize: '0.62rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {entity.step.tipo_prazo === 'uteis' ? 'úteis' : 'corridos'}
          </span>
        )}
      </div>

      <div
        className="board-card-assignee"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.25rem 0.5rem 0.25rem 0.25rem',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          background: 'var(--card-bg)',
          width: 'fit-content',
          maxWidth: '100%',
        }}
      >
        {entity.responsavel ? (
          <>
            <div
              className={`avatar ${avatarColorClass(entity.responsavel.id ?? entity.responsavel.nome)}`}
              style={{ width: 20, height: 20, fontSize: '0.55rem', fontWeight: 800 }}
            >
              {getInitials(entity.responsavel.nome)}
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>
              {entity.responsavel.nome}
            </span>
          </>
        ) : (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Sem responsável
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {entity.etapaNome}
          </span>
          <span
            style={{
              fontSize: '0.65rem',
              color: 'var(--text-muted)',
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {etapaIdx + 1}/{total}
          </span>
        </div>
        <div
          style={{
            height: '5px',
            background: 'var(--surface-hover)',
            borderRadius: '999px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: accent,
              borderRadius: '999px',
              opacity: 0.85,
            }}
          />
        </div>
      </div>

      {entity.cover && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid var(--card-bg)',
            background: 'var(--surface-hover)',
          }}
        >
          {entity.cover.media_lost_at ? (
            <MediaUnavailable size="compact" />
          ) : (
            <img
              src={entity.cover.thumbnail_url ?? entity.cover.url}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
