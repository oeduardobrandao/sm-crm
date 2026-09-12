import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  CircleDashed,
  ExternalLink,
  FileText,
  FolderMinus,
  GalleryHorizontalEnd,
  Image,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MediaUnavailable } from '@/components/MediaUnavailable';
import { avatarColorClass } from '@/lib/avatarColor';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { PostEntity } from '../boardEntity';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from './PostStatusChip';
import type { WorkflowPost } from '../../../store';

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

// Fallback icon by post tipo when the entity has no cover thumbnail yet --
// same mapping as PostsKanbanView's TIPO_ICONS, kept local since the two
// boards don't share a component module for this.
const TIPO_ICONS: Record<WorkflowPost['tipo'], typeof Image> = {
  feed: Image,
  reels: Clapperboard,
  carrossel: GalleryHorizontalEnd,
  stories: CircleDashed,
};

interface PostProcessCardProps {
  entity: PostEntity;
  onClick?: () => void;
  isDragOverlay?: boolean;
  onForwardClick?: () => void;
  onRevertClick?: () => void;
  dragHandle?: React.ReactNode;
  forwardLabel?: 'Avançar etapa' | 'Concluir processo';
  canRevert?: boolean;
  /** Encerra o processo individual: `remove_post_process` desliga o processo e
   *  mantém o post, não apaga nada -- daí o rótulo "Encerrar processo" (spec
   *  §4). Nenhum caller passa isto ainda -- TODO(fluxos-cards-compactos):
   *  ligar a removePostProcess (store/postProcesses.ts) quando o fluxo de
   *  encerramento via card existir; hoje só o drawer/lista o serve. */
  onRemoveProcessClick?: () => void;
  /** Exclui o post por trás do processo. Nenhum caller passa isto ainda --
   *  TODO(fluxos-cards-compactos): ligar a uma função de exclusão de post
   *  quando o fluxo de exclusão via card existir. */
  onDeleteClick?: () => void;
}

/**
 * Card de um post individual no quadro de Fluxos (spec §4.2). Fase "cards
 * compactos" (docs/superpowers/specs/2026-09-12-fluxos-posts-individuais-ux-design.md
 * §4): silhueta curta -- thumb 26px (capa do post ou ícone do tipo) + cliente
 * + badge "Individual" ícone-only; título; uma linha combinando a pill de
 * prazo (texto + tipo_prazo) e o chip de tipo+status; rodapé com responsável
 * sem borda, alça de arrastar, kebab (abrir, voltar etapa, encerrar processo,
 * excluir post) e o botão de avançar fora do kebab;
 * barra de progresso de 4px sem rótulo visível (o texto "N/total" vira
 * tooltip). A marcação espelha WorkflowCard para que os dois tipos fiquem
 * visualmente na mesma família; o tipo é identificado por texto e ícone, a
 * cor é complementar.
 *
 * Não há item "editar processo" no kebab: essa capacidade não existe (a única
 * RPC de edição mexe em responsável/prazo de uma etapa por vez, dentro do
 * drawer alcançado por "Abrir").
 */
export function PostProcessCard({
  entity,
  onClick,
  isDragOverlay,
  onForwardClick,
  onRevertClick,
  dragHandle,
  forwardLabel,
  canRevert,
  onRemoveProcessClick,
  onDeleteClick,
}: PostProcessCardProps) {
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
  const TipoIcon = TIPO_ICONS[post.tipo];

  const hasKebabItems = Boolean(
    onClick || (canRevert && onRevertClick) || onRemoveProcessClick || onDeleteClick,
  );
  const showFooter = Boolean(dragHandle || onForwardClick || hasKebabItems);

  return (
    <div
      className={`board-card board-card--post ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
      data-testid="post-process-card"
      style={{
        opacity: isDragOverlay ? 0.85 : 1,
        position: 'relative',
        padding: '0.7rem',
        gap: '0.45rem',
        borderRadius: '10px',
      }}
      onClick={onClick}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.4rem',
        }}
      >
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
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '7px',
              overflow: 'hidden',
              flexShrink: 0,
              background: 'var(--surface-hover)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {entity.cover && entity.cover.media_lost_at ? (
              <MediaUnavailable size="compact" />
            ) : entity.cover ? (
              <img
                src={entity.cover.thumbnail_url ?? entity.cover.url}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <TipoIcon size={13} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
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
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {cliente.nome}
              </span>
            </>
          ) : (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.cliente_nome || '—'}
            </span>
          )}
        </span>
        <span
          className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual post-fluxo-tag--icon-only"
          role="img"
          aria-label="Processo individual"
          title="Processo individual"
          style={{ flexShrink: 0 }}
        >
          <FileText size={12} aria-hidden="true" />
        </span>
      </div>

      <div
        className="board-card-title"
        style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.35, color: 'var(--text-main)' }}
      >
        {entity.titulo || 'Post sem título'}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <span
          className={`board-card-deadline board-card-deadline-pill ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
          }}
        >
          {deadlineText}
          {entity.step.tipo_prazo && (
            <span className="board-card-prazo-type-inner">
              {entity.step.tipo_prazo === 'uteis' ? 'úteis' : 'corridos'}
            </span>
          )}
        </span>
        <span className="board-card-type-status-chip">
          <span className="board-card-type-status-chip-label">{TIPO_LABELS[post.tipo]}</span>
          <PostStatusChip post={post} registry={registry} />
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-main)' }}>
          {entity.etapaNome}
        </span>
        <div
          className="board-progress-track"
          data-testid="post-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={etapaIdx + 1}
          aria-valuetext={`${entity.etapaNome} ${etapaIdx + 1}/${total}`}
          aria-label="Progresso do processo"
          title={`${entity.etapaNome} ${etapaIdx + 1}/${total}`}
          style={{
            height: '4px',
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

      {showFooter && (
        <div
          className="board-card-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            paddingTop: '0.45rem',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              minWidth: 0,
              flex: '1 1 auto',
              overflow: 'hidden',
            }}
          >
            {entity.responsavel ? (
              <>
                <div
                  className={`avatar ${avatarColorClass(entity.responsavel.id ?? entity.responsavel.nome)}`}
                  style={{
                    width: 18,
                    height: 18,
                    fontSize: '0.5rem',
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {getInitials(entity.responsavel.nome)}
                </div>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entity.responsavel.nome}
                </span>
              </>
            ) : (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Sem responsável
              </span>
            )}
          </div>

          {dragHandle && (
            <span
              className="board-card-drag-handle"
              style={{ cursor: 'grab', display: 'inline-flex', flexShrink: 0 }}
            >
              {dragHandle}
            </span>
          )}

          {hasKebabItems && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="btn-edit-workflow board-card-kebab"
                  aria-label="Mais opções"
                  title="Mais opções"
                  style={{ padding: '0.35rem 0.55rem', borderRadius: '10px', flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {onClick && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onClick();
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir
                  </DropdownMenuItem>
                )}
                {canRevert && onRevertClick && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onRevertClick();
                    }}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Voltar etapa
                  </DropdownMenuItem>
                )}
                {onRemoveProcessClick && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveProcessClick();
                    }}
                  >
                    <FolderMinus className="h-3.5 w-3.5" />
                    Encerrar processo
                  </DropdownMenuItem>
                )}
                {onDeleteClick && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteClick();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Excluir post
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {onForwardClick && (
            <button
              className="btn-edit-workflow btn-forward-etapa"
              aria-label={forwardLabel ?? 'Avançar etapa'}
              title={forwardLabel ?? 'Avançar etapa'}
              style={{
                padding: '0.35rem 0.55rem',
                borderRadius: '10px',
                flexShrink: 0,
                marginLeft: 'auto',
                color: '#3ecf8e',
                borderColor: '#3ecf8e',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onForwardClick();
              }}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
