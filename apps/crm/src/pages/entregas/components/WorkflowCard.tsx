import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Edit2, Check, FileText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { BoardCard } from '../hooks/useEntregasData';
import { updateWorkflowEtapa, type Membro } from '../../../store';

const avatarColors = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

// Deadline accent colors mapped from class name
const deadlineAccent: Record<string, string> = {
  'deadline-ok': '#3ecf8e',
  'deadline-caution': '#eab308',
  'deadline-warning': '#ea580c',
  'deadline-overdue': '#ef4444',
};

interface WorkflowCardProps {
  card: BoardCard;
  onClick?: () => void;
  /** Set to true when rendering inside DragOverlay — disables pointer events */
  isDragOverlay?: boolean;
  /** Optional drag handle element rendered at the top-right */
  dragHandle?: React.ReactNode;
  membros?: Membro[];
  onRefresh?: () => void;
  onRevertClick?: () => void;
  onForwardClick?: () => void;
  /** Opens the posts/sub-tasks drawer for this workflow */
  onPostsClick?: () => void;
  /** Number of posts associated with this workflow (shown as badge) */
  postsCount?: number;
  /** Number of posts approved by client */
  approvedPostsCount?: number;
}

export function WorkflowCard({ card, onClick, isDragOverlay, dragHandle, membros, onRefresh, onRevertClick, onForwardClick, onPostsClick, postsCount, approvedPostsCount }: WorkflowCardProps) {
  const navigate = useNavigate();
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [localMembro, setLocalMembro] = useState<Membro | undefined | null>(undefined);
  const dl = card.deadline;
  const deadlineClass = dl.estourado
    ? 'deadline-overdue'
    : dl.urgente
    ? 'deadline-warning'
    : dl.diasRestantes <= 3
    ? 'deadline-caution'
    : 'deadline-ok';
  const deadlineText = dl.estourado
    ? `${Math.abs(dl.diasRestantes)}d atrasado`
    : dl.diasRestantes === 0 && dl.horasRestantes === 0
    ? 'Vence agora'
    : dl.diasRestantes === 0
    ? `${dl.horasRestantes}h restantes`
    : dl.horasRestantes > 0
    ? `${dl.diasRestantes}d ${dl.horasRestantes}h restantes`
    : `${dl.diasRestantes}d restantes`;
  const progressPct = card.totalEtapas > 0 ? Math.round((card.etapaIdx / card.totalEtapas) * 100) : 0;
  const iniciadoEm = card.etapa.iniciado_em
    ? new Date(card.etapa.iniciado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : null;

  const accent = deadlineAccent[deadlineClass] ?? '#3ecf8e';

  return (
    <div
      className={`board-card ${deadlineClass}`}
      style={{
        opacity: isDragOverlay ? 0.85 : 1,
        position: 'relative',
        zIndex: assignDropdownOpen ? 50 : 1,
        padding: '0.9rem',
        gap: '0.6rem',
        borderLeft: `3px solid ${accent}`,
        borderRadius: '10px',
      }}
      onClick={assignDropdownOpen ? () => setAssignDropdownOpen(false) : onClick}
    >
      {/* Top row: client + recurrent + drag handle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          className="board-card-client"
          style={{
            borderLeft: 'none',
            paddingLeft: 0,
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          {card.cliente ? (
            <>
              {card.clienteAvatarUrl ? (
                <img
                  src={card.clienteAvatarUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: card.cliente.cor || 'var(--surface-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.45rem', fontWeight: 800, color: '#fff', flexShrink: 0,
                }}>
                  {getInitials(card.cliente.nome)}
                </div>
              )}
              <span
                role="link"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${card.cliente!.id}`); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate(`/clientes/${card.cliente!.id}`); } }}
                style={{
                  cursor: 'pointer',
                  color: card.cliente.cor || 'var(--text-muted)',
                  opacity: 0.85,
                  fontWeight: 700,
                }}
              >
                {card.cliente.nome}
              </span>
            </>
          ) : '—'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {card.workflow.recorrente && (
            <span
              title="Recorrente"
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                background: 'var(--surface-hover)',
                borderRadius: '999px',
                padding: '0.05rem 0.4rem',
                letterSpacing: '0',
              }}
            >
              ↻
            </span>
          )}
          {dragHandle && (
            <div style={{ cursor: 'grab', color: 'var(--text-muted)', display: 'flex' }}>
              {dragHandle}
            </div>
          )}
        </div>
      </div>

      {/* Title */}
      <div
        className="board-card-title"
        style={{
          fontSize: '0.9rem',
          fontWeight: 700,
          lineHeight: 1.35,
          color: 'var(--text-main)',
          letterSpacing: '-0.01em',
        }}
      >
        {card.workflow.titulo}
      </div>

      {/* Deadline badge + prazo type */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span
          className={`board-card-deadline ${deadlineClass}`}
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
            letterSpacing: '0.01em',
          }}
        >
          {deadlineText}
        </span>
        <span
          className="board-card-prazo-type"
          style={{
            fontSize: '0.62rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {card.etapa.tipo_prazo === 'uteis' ? 'úteis' : 'corridos'}
        </span>
      </div>

      {/* Assignee chip */}
      <DropdownMenu open={assignDropdownOpen} onOpenChange={(open) => {
        if (membros) setAssignDropdownOpen(open);
      }}>
        <DropdownMenuTrigger asChild>
          <div
            className={`board-card-assignee ${membros ? 'board-card-assignee--clickable' : ''}`}
            style={{
              cursor: membros ? 'pointer' : 'default',
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.25rem 0.5rem 0.25rem 0.25rem',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'var(--card-bg)',
              width: 'fit-content',
              maxWidth: '100%',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onClick={(e) => {
              if (!membros) return;
              e.stopPropagation();
            }}
          >
            {(() => {
              const displayMembro = localMembro !== undefined ? localMembro : card.membro;
              return displayMembro ? (
                <>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: getAvatarColor(displayMembro.nome), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                    {getInitials(displayMembro.nome)}
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayMembro.nome}
                  </span>
                </>
              ) : (
                <>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    ?
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Sem responsável</span>
                </>
              );
            })()}
          </div>
        </DropdownMenuTrigger>

        {membros && (
          <DropdownMenuContent align="start" style={{ zIndex: 99999, minWidth: '160px' }}>
            {membros.map(m => (
              <DropdownMenuItem
                key={m.id}
                onClick={async (e) => {
                  e.stopPropagation();
                  setAssignDropdownOpen(false);
                  setLocalMembro(m);
                  try {
                    await updateWorkflowEtapa(card.etapa.id!, { responsavel_id: m.id });
                    toast.success('Responsável atualizado!');
                    onRefresh?.();
                  } catch {
                    setLocalMembro(undefined);
                    toast.error('Erro ao atualizar');
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: getAvatarColor(m.nome), color: '#fff', fontSize: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {getInitials(m.nome)}
                </div>
                {m.nome}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      {/* Client approval badge */}
      {card.etapa.tipo === 'aprovacao_cliente' && (
        <div className="board-card-approval">
          {postsCount != null && postsCount > 0 && approvedPostsCount === postsCount ? (
            <div
              className="board-card-approval-badge"
              style={{ borderRadius: '999px', padding: '0.2rem 0.65rem', fontSize: '0.68rem', letterSpacing: '0.02em', background: 'rgba(62, 207, 142, 0.15)', color: 'var(--success)' }}
            >
              ✓ Aprovado pelo cliente
            </div>
          ) : (
            <div
              className="board-card-approval-badge"
              style={{ borderRadius: '999px', padding: '0.2rem 0.65rem', fontSize: '0.68rem', letterSpacing: '0.02em' }}
            >
              ⏳ Aguardando cliente
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div
          style={{
            flex: 1,
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
              transition: 'width 0.4s ease',
              opacity: 0.85,
            }}
          />
        </div>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
          {card.etapaIdx + 1}/{card.totalEtapas}
        </span>
      </div>

      {/* Initiated date */}
      {iniciadoEm && (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
          iniciada em {iniciadoEm}
        </div>
      )}

      {/* Post cover circles */}
      {card.postCovers && card.postCovers.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', paddingTop: '0.15rem' }}>
          {card.postCovers.slice(0, 5).map((media, i) => (
            <div
              key={media.id}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                overflow: 'hidden',
                border: '2px solid var(--card-bg)',
                marginLeft: i === 0 ? 0 : -10,
                flexShrink: 0,
                background: 'var(--surface-hover)',
                zIndex: card.postCovers!.length - i,
              }}
            >
              <img
                src={media.thumbnail_url ?? media.url}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          ))}
          {card.postCovers.length > 5 && (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '2px solid var(--card-bg)',
                marginLeft: -10,
                flexShrink: 0,
                background: 'var(--surface-hover)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.6rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
              }}
            >
              +{card.postCovers.length - 5}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          gap: '0.3rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid var(--border-color)',
          marginTop: '0.1rem',
        }}
      >
        {card.etapaIdx > 0 && onRevertClick && (
          <button
            className="btn-revert-etapa"
            title="Voltar etapa"
            style={{ padding: '0.35rem 0.55rem', borderRadius: '10px', flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); onRevertClick(); }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          className="btn-edit-workflow"
          title="Editar fluxo"
          style={{ padding: '0.35rem 0.55rem', borderRadius: '10px', flexShrink: 0 }}
          onClick={e => { e.stopPropagation(); onClick?.(); }}
        >
          <Edit2 className="h-3.5 w-3.5" />
        </button>
        <button
          className="btn-edit-workflow"
          title="Posts do fluxo"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.4rem 0.75rem',
            borderRadius: '10px',
            border: '0px solid var(--border-color)',
            background: 'transparent',
            fontSize: '0.72rem',
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0,
            position: 'relative',
            transition: 'all 0.15s',
          }}
          onClick={e => { e.stopPropagation(); onPostsClick?.(); }}
        >
          <FileText className="h-3.5 w-3.5" />
          Posts
          {postsCount !== undefined && postsCount > 0 && (
            <span className="board-card-posts-badge">{postsCount}</span>
          )}
        </button>
        {onForwardClick && (
          <button
            className="btn-edit-workflow btn-forward-etapa"
            title={card.etapaIdx < card.totalEtapas - 1 ? 'Concluir etapa e avançar' : 'Concluir fluxo'}
            style={{ padding: '0.35rem 0.55rem', borderRadius: '10px', flexShrink: 0, marginLeft: 'auto', color: '#3ecf8e', borderColor: '#3ecf8e' }}
            onClick={e => { e.stopPropagation(); onForwardClick(); }}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
