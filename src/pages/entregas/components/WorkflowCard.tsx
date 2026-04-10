import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Edit2, Share2, Check, FileText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { BoardCard } from '../hooks/useEntregasData';
import { updateWorkflowEtapa, createPortalToken, type Membro } from '../../../store';

const avatarColors = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

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
}

export function WorkflowCard({ card, onClick, isDragOverlay, dragHandle, membros, onRefresh, onRevertClick, onForwardClick, onPostsClick, postsCount }: WorkflowCardProps) {
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

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const portalToken = await createPortalToken(card.workflow.id!);
      const url = `${window.location.origin}/portal/${portalToken}`;
      if (navigator.share) {
        await navigator.share({ title: card.workflow.titulo, text: `Acompanhe a entrega: ${card.workflow.titulo}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Link do portal copiado!');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      toast.error('Erro ao compartilhar link do portal.');
    }
  };

  const sanitizeUrl = (url: string) => url.startsWith('http') ? url : `https://${url}`;

  return (
    <div
      className={`board-card ${deadlineClass}`}
      style={{ opacity: isDragOverlay ? 0.8 : 1, position: 'relative', zIndex: assignDropdownOpen ? 50 : 1 }}
      onClick={assignDropdownOpen ? () => setAssignDropdownOpen(false) : onClick}
    >
      <div className="board-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span
          className="board-card-client"
          style={{ borderLeft: `3px solid ${card.cliente?.cor || '#888'}`, paddingLeft: '0.5rem' }}
        >
          {card.cliente ? (
            <span
              role="link"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${card.cliente!.id}`); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate(`/clientes/${card.cliente!.id}`); } }}
              style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '2px' }}
            >
              {card.cliente.nome}
            </span>
          ) : '—'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {card.workflow.recorrente && <span title="Recorrente" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>↻</span>}
          {dragHandle && (
            <div style={{ cursor: 'grab', color: 'var(--text-muted)' }}>
              {dragHandle}
            </div>
          )}
        </div>
      </div>
      <div className="board-card-title">{card.workflow.titulo}</div>
      <div className="board-card-meta">
        <span className={`board-card-deadline ${deadlineClass}`}>{deadlineText}</span>
        <span className="board-card-prazo-type">{card.etapa.tipo_prazo === 'uteis' ? 'dias úteis' : 'dias corridos'}</span>
      </div>

      <DropdownMenu open={assignDropdownOpen} onOpenChange={(open) => {
        if (membros) setAssignDropdownOpen(open);
      }}>
        <DropdownMenuTrigger asChild>
          <div
            className={`board-card-assignee ${membros ? 'board-card-assignee--clickable' : ''}`}
            style={{ cursor: membros ? 'pointer' : 'default', position: 'relative' }}
            onClick={(e) => {
              if (!membros) return;
              e.stopPropagation();
            }}
          >
            {(() => {
              const displayMembro = localMembro !== undefined ? localMembro : card.membro;
              return displayMembro ? (
                <>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: getAvatarColor(displayMembro.nome), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {getInitials(displayMembro.nome)}
                  </div>
                  <span>{displayMembro.nome}</span>
                </>
              ) : (
                <>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                    ?
                  </div>
                  <span>Sem responsável</span>
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

      {(card.workflow.link_notion || card.workflow.link_drive) && (
        <div className="board-card-links">
          {card.workflow.link_notion && (
            <a href={sanitizeUrl(card.workflow.link_notion)} target="_blank" rel="noopener noreferrer" className="board-card-link" onClick={e => e.stopPropagation()}>
              Notion
            </a>
          )}
          {card.workflow.link_drive && (
            <a href={sanitizeUrl(card.workflow.link_drive)} target="_blank" rel="noopener noreferrer" className="board-card-link" onClick={e => e.stopPropagation()}>
              Drive
            </a>
          )}
        </div>
      )}

      {card.etapa.tipo === 'aprovacao_cliente' && (
        <div className="board-card-approval">
          <div className="board-card-approval-badge">
            ⏳ Aguardando cliente
          </div>
        </div>
      )}

      <div className="board-card-progress">
        <div className="board-progress-bar">
          <div className="board-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="board-progress-label">{card.etapaIdx + 1}/{card.totalEtapas}</span>
      </div>

      {iniciadoEm && <div className="board-card-created">iniciada em {iniciadoEm}</div>}

      <div className="board-card-actions">
        {card.etapaIdx > 0 && onRevertClick && (
          <button className="btn-revert-etapa" title="Voltar etapa" style={{ padding: '0.4rem', flexShrink: 0 }} onClick={e => { e.stopPropagation(); onRevertClick(); }}>
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <button className="btn-edit-workflow" title="Editar fluxo" style={{ padding: '0.4rem', flexShrink: 0 }} onClick={e => { e.stopPropagation(); onClick?.(); }}>
          <Edit2 className="h-4 w-4" />
        </button>
        <button
          className="btn-edit-workflow"
          title="Posts do fluxo"
          style={{ padding: '0.4rem', flexShrink: 0, position: 'relative' }}
          onClick={e => { e.stopPropagation(); onPostsClick?.(); }}
        >
          <FileText className="h-4 w-4" />
          {postsCount !== undefined && postsCount > 0 && (
            <span className="board-card-posts-badge">{postsCount}</span>
          )}
        </button>
        <button className="btn-edit-workflow" title="Compartilhar portal do cliente" style={{ padding: '0.4rem', flexShrink: 0 }} onClick={handleShare}>
          <Share2 className="h-4 w-4" />
        </button>
        {onForwardClick && (
          <button className="btn-edit-workflow btn-forward-etapa" title={card.etapaIdx < card.totalEtapas - 1 ? 'Concluir etapa e avançar' : 'Concluir fluxo'} style={{ padding: '0.4rem', flexShrink: 0, color: 'var(--success)' }} onClick={e => { e.stopPropagation(); onForwardClick(); }}>
            <Check className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
