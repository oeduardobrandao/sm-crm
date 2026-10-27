import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  Copy,
  CopyPlus,
  ExternalLink,
  FileText,
  FolderMinus,
  MessageSquare,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { TIPO_ICONS } from '../tipoIcons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MediaUnavailable } from '@/components/MediaUnavailable';
import { copyAppLink } from '@/lib/copyAppLink';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { getInitials } from '@/lib/initials';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { publicacaoPill, type PostEntity } from '../boardEntity';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from './PostStatusChip';
import { DeadlinePill } from './DeadlinePill';
import { PublicacaoPillContent } from './PublicacaoPillContent';
import { progressColor } from '../progressColor';
import { useVidroShell } from '@/components/layout/PageToolbarContext';
import type { WorkflowPost } from '../../../store';
import { ClienteFoto } from '@/components/ClienteFoto';

interface PostProcessCardProps {
  entity: PostEntity;
  onClick?: () => void;
  isDragOverlay?: boolean;
  onForwardClick?: () => void;
  onRevertClick?: () => void;
  dragHandle?: React.ReactNode;
  forwardLabel?: string;
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
  /** "Duplicar post": copia o post e o processo na mesma etapa. */
  onDuplicateClick?: () => void;
  /** Unread discussion messages on this post. Badge only when > 0. */
  discussaoNaoLidas?: number;
  /** A coluna ordena por data de publicação: a pill mostra essa data no lugar
   *  do prazo da etapa. */
  showPublishDate?: boolean;
}

/**
 * Card de um post individual no quadro de Fluxos (spec §4.2), silhueta
 * compacta em quatro linhas: cabeçalho com thumb 28px (capa do post ou ícone
 * do tipo) + título numa linha só (truncado, texto completo no title) +
 * subtítulo "cliente · tipo" + badge "Individual" ícone-only; uma linha com a
 * pill de prazo (texto + tipo_prazo) e o chip de status; uma linha com o nome
 * da etapa, a barra de progresso de 4px e o contador "N/total" (aria-hidden:
 * o progressbar já anuncia o mesmo valor); rodapé de 26px com responsável,
 * alça de arrastar, kebab (abrir, voltar etapa, encerrar processo, excluir
 * post) e o botão de avançar fora do kebab. A marcação espelha WorkflowCard
 * para que os dois tipos fiquem visualmente na mesma família; o tipo é
 * identificado por texto e ícone, a cor é complementar.
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
  onDuplicateClick,
  showPublishDate,
  discussaoNaoLidas,
}: PostProcessCardProps) {
  const { t } = useTranslation('postPanels');
  const navigate = useNavigate();
  // Under Vidro the board actions trade the `!important` .btn-edit-workflow for
  // vidro-board-action and drop their inline radius/padding, so buttons.css can paint them.
  const vidroShell = useVidroShell();
  const boardAction = vidroShell ? 'vidro-board-action' : 'btn-edit-workflow';
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
    ? t('postProcessCard.noDeadline')
    : dl.estourado
      ? t('postProcessCard.daysOverdue', { days: Math.abs(dl.diasRestantes) })
      : dl.diasRestantes === 0 && dl.horasRestantes === 0
        ? t('postProcessCard.dueNow')
        : dl.diasRestantes === 0
          ? t('postProcessCard.hoursLeft', { hours: dl.horasRestantes })
          : dl.horasRestantes > 0
            ? t('postProcessCard.daysHoursLeft', {
                days: dl.diasRestantes,
                hours: dl.horasRestantes,
              })
            : t('postProcessCard.daysLeft', { days: dl.diasRestantes });
  const etapaIdx = entity.steps.findIndex((s) => s.ordem === entity.etapaOrdem);
  const total = entity.steps.length;
  const progressPct = total > 0 && etapaIdx >= 0 ? Math.round((etapaIdx / total) * 100) : 0;
  const progressFill = progressColor(etapaIdx, total);
  const post = entity.process.post;
  const cliente = entity.cliente;
  const TipoIcon = TIPO_ICONS[post.tipo];
  const publicacao = showPublishDate ? publicacaoPill(entity) : null;
  const pillStyle: React.CSSProperties = {
    fontSize: '0.66rem',
    fontWeight: 700,
    padding: '0.12rem 0.5rem',
    borderRadius: '999px',
    // Keeps its full width; ellipsizes only when wider than the card alone.
    flexShrink: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  // Copiar link do post está sempre disponível num card real; só o clone
  // efêmero do DragOverlay (sem props de ação) fica sem kebab.
  const hasKebabItems = !isDragOverlay;
  const showFooter = Boolean(dragHandle || onForwardClick || hasKebabItems);

  return (
    <div
      className={`board-card board-card--post ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
      data-testid="post-process-card"
      style={{
        opacity: isDragOverlay ? 0.85 : 1,
        position: 'relative',
        padding: '0.6rem 0.65rem',
        gap: '0.4rem',
        borderRadius: '10px',
      }}
      onClick={onClick}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
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
        <div style={{ minWidth: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
          <div
            className="board-card-title"
            title={entity.titulo || t('postProcessCard.untitled')}
            style={{
              fontSize: '0.86rem',
              fontWeight: 700,
              lineHeight: 1.3,
              color: 'var(--text-main)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entity.titulo || t('postProcessCard.untitled')}
          </div>
          <span
            className="board-card-client"
            style={{
              borderLeft: 'none',
              paddingLeft: 0,
              fontSize: '0.68rem',
              fontWeight: 500,
              lineHeight: 1.3,
              textTransform: 'none',
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              minWidth: 0,
            }}
          >
            {cliente ? (
              <>
                <ClienteFoto
                  srcs={[entity.clienteAvatarUrl, cliente.foto_url]}
                  alt=""
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
                  }}
                  fallback={
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: cliente.cor || '#6b7280',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.4rem',
                        fontWeight: 800,
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(cliente.nome)}
                    </div>
                  }
                />
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
            <span aria-hidden="true" style={{ opacity: 0.6 }}>
              ·
            </span>
            <span className="board-card-type-status-chip-label" style={{ fontSize: 'inherit' }}>
              {TIPO_LABELS[post.tipo]}
            </span>
          </span>
        </div>
        {discussaoNaoLidas != null && discussaoNaoLidas > 0 && (
          <span
            className="board-card-discussao-badge"
            role="img"
            aria-label={t('postProcessCard.newMessages', { count: discussaoNaoLidas })}
            title={t('postProcessCard.newMessages', { count: discussaoNaoLidas })}
          >
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {discussaoNaoLidas}
          </span>
        )}
        <span
          className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual post-fluxo-tag--icon-only"
          role="img"
          aria-label={t('postProcessCard.individualProcess')}
          title={t('postProcessCard.individualProcess')}
          style={{ flexShrink: 0 }}
        >
          <FileText size={12} aria-hidden="true" />
        </span>
      </div>

      {/* Wraps instead of squeezing: when both pills don't fit, the status chip
          drops below rather than cutting the deadline off. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.35rem 0.4rem',
        }}
      >
        {publicacao ? (
          <span
            className="board-card-deadline board-card-deadline-pill deadline-neutral"
            title={publicacao.title}
            style={pillStyle}
          >
            <PublicacaoPillContent pill={publicacao} />
          </span>
        ) : (
          <DeadlinePill
            className={`board-card-deadline board-card-deadline-pill ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
            style={pillStyle}
            relativeText={deadlineText}
            dueDate={entity.prazoEfetivo}
            estourado={dl.estourado}
            tipoPrazo={entity.step.tipo_prazo}
          />
        )}
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <PostStatusChip post={post} registry={registry} />
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span
          style={{
            fontSize: '0.66rem',
            fontWeight: 600,
            color: 'var(--text-main)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '55%',
          }}
        >
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
          aria-label={t('postProcessCard.progressAria')}
          title={`${entity.etapaNome} ${etapaIdx + 1}/${total}`}
          style={{
            flex: '1 1 auto',
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
              background: progressFill,
              borderRadius: '999px',
              opacity: 0.85,
            }}
          />
        </div>
        <span
          aria-hidden="true"
          style={{
            fontSize: '0.62rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {etapaIdx + 1}/{total}
        </span>
      </div>

      {showFooter && (
        <div
          className="board-card-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            paddingTop: '0.35rem',
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
                <PessoaAvatar
                  nome={entity.responsavel.nome}
                  fotoUrl={entity.responsavel.avatar_url}
                  seed={entity.responsavel.id}
                  size={18}
                  className="!text-[0.5rem] !font-extrabold"
                />
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
                {t('postProcessCard.noAssignee')}
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
                  className={`${boardAction} board-card-kebab`}
                  aria-label={t('postProcessCard.moreOptions')}
                  title={t('postProcessCard.moreOptions')}
                  style={
                    vidroShell
                      ? { height: 26, flexShrink: 0 }
                      : { height: 26, padding: '0 0.5rem', borderRadius: '8px', flexShrink: 0 }
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    copyAppLink(`/entregas?post=${post.id}`);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t('postProcessCard.copyLink')}
                </DropdownMenuItem>
                {onClick && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onClick();
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('postProcessCard.open')}
                  </DropdownMenuItem>
                )}
                {onDuplicateClick && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateClick();
                    }}
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                    {t('postProcessCard.duplicate')}
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
                    {t('postProcessCard.revert')}
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
                    {t('postProcessCard.closeProcess')}
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
                    {t('postProcessCard.deletePost')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {onForwardClick && (
            <button
              className={`${boardAction} btn-forward-etapa`}
              aria-label={forwardLabel ?? t('postProcessCard.forward')}
              title={forwardLabel ?? t('postProcessCard.forward')}
              style={{
                height: 26,
                ...(vidroShell ? null : { padding: '0 0.5rem', borderRadius: '8px' }),
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
