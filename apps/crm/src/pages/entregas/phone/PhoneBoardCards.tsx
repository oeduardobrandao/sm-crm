import type { ReactNode } from 'react';
import { Check, FileText, GripVertical, MoreHorizontal } from 'lucide-react';
import type { ContextMenuTriggerProps } from '@/components/mobile/ContextMenu';
import { MediaUnavailable } from '@/components/MediaUnavailable';
import { getInitials } from '@/lib/initials';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostEntity } from '../boardEntity';
import { TIPO_ICONS } from '../tipoIcons';
import { TIPO_LABELS } from '../postLabels';
import { progressColor } from '../progressColor';
import { PostStatusChip } from '../components/PostStatusChip';
import {
  deadlineTone,
  relativeDeadline,
  workflowForwardLabel,
  workflowStatusLine,
} from './phoneFormat';
import './entregasPhone.css';

export interface WorkflowCardCounts {
  postsCount: number;
  approvedPostsCount: number;
  clearedClienteCount: number;
  revisaoInternaCount: number;
  awaitingClienteCount: number;
}

function ClienteAvatar({
  nome,
  cor,
  url,
}: {
  nome: string;
  cor?: string | null;
  url?: string | null;
}) {
  return url ? (
    <img src={url} alt="" loading="lazy" decoding="async" className="phone-ent-card__avatar" />
  ) : (
    <span
      className="phone-ent-card__avatar phone-ent-card__avatar--initials"
      style={{ background: cor || 'var(--phone-neutral-action)' }}
      aria-hidden="true"
    >
      {getInitials(nome)}
    </span>
  );
}

function Progress({ idx, total, label }: { idx: number; total: number; label: string }) {
  const pct = total > 0 && idx >= 0 ? Math.round((idx / total) * 100) : 0;
  return (
    <span
      className="phone-ent-card__progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={idx + 1}
      aria-valuetext={`${label} ${idx + 1}/${total}`}
      aria-label={label}
    >
      <span style={{ width: `${pct}%`, background: progressColor(idx, total) }} />
    </span>
  );
}

export interface PhoneWorkflowCardProps {
  card: BoardCard;
  counts: WorkflowCardCounts;
  onOpen?: () => void;
  onForward?: () => void;
  /** "…" button: the card menu's explicit trigger. */
  triggerProps?: ContextMenuTriggerProps;
  /** Reordenar mode: a drag handle replaces the action buttons. */
  dragHandle?: ReactNode;
  /** Static copy for the menu preview and the drag overlay. */
  preview?: boolean;
}

/** Fluxo card on the phone board (EntregasKanban mockup). */
export function PhoneWorkflowCard({
  card,
  counts,
  onOpen,
  onForward,
  triggerProps,
  dragHandle,
  preview,
}: PhoneWorkflowCardProps) {
  const tone = deadlineTone(card.deadline);
  const status = workflowStatusLine(card, counts);
  const meta = [
    card.membro?.nome ?? 'Sem responsável',
    `${counts.postsCount} post${counts.postsCount === 1 ? '' : 's'}`,
    counts.approvedPostsCount ? `${counts.approvedPostsCount} ✓` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const title = card.workflow.titulo;
  return (
    <article
      className="phone-ent-card"
      data-tone={tone}
      aria-label={preview ? undefined : `${title}, ${card.cliente?.nome ?? 'sem cliente'}`}
      data-testid={preview ? undefined : 'phone-workflow-card'}
    >
      <button
        type="button"
        className="phone-ent-card__main"
        onClick={onOpen}
        disabled={preview || !onOpen}
        tabIndex={preview ? -1 : undefined}
      >
        <span className="phone-ent-card__top">
          <span className="phone-ent-card__client">
            {card.cliente ? (
              <>
                <ClienteAvatar
                  nome={card.cliente.nome}
                  cor={card.cliente.cor}
                  url={card.clienteAvatarUrl}
                />
                <span className="phone-ent-card__client-name">{card.cliente.nome}</span>
              </>
            ) : (
              <span className="phone-ent-card__client-name">Sem cliente</span>
            )}
            {card.workflow.recorrente && (
              <span className="phone-ent-card__badge" aria-label="Recorrente" title="Recorrente">
                ↻
              </span>
            )}
            {card.workflow.created_via === 'agent' && (
              <span className="phone-ent-card__badge" title="Criado por agente de IA">
                IA
              </span>
            )}
          </span>
          <span className="phone-ent-card__deadline" data-tone={tone}>
            {relativeDeadline(card.deadline)}
          </span>
        </span>
        <strong className="phone-ent-card__title">{title}</strong>
        {status && <span className="phone-ent-card__status">{status}</span>}
      </button>
      <div className="phone-ent-card__foot">
        <span className="phone-ent-card__meta">
          <span className="phone-ent-card__meta-text">{meta}</span>
          <Progress
            idx={card.etapaIdx}
            total={card.totalEtapas}
            label={`Progresso do fluxo: ${card.etapa.nome}`}
          />
        </span>
        {dragHandle ? (
          dragHandle
        ) : preview ? null : (
          <>
            {triggerProps && (
              <button
                {...triggerProps}
                className="phone-ent-card__icon-btn"
                aria-label={`Mais ações de ${title}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
            )}
            {onForward && (
              <button
                type="button"
                className="phone-ent-card__icon-btn phone-ent-card__forward"
                aria-label={workflowForwardLabel(card)}
                onClick={onForward}
              >
                <Check aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export interface PhonePostProcessCardProps {
  entity: PostEntity;
  onOpen?: () => void;
  onForward?: () => void;
  forwardLabel?: 'Avançar etapa' | 'Concluir processo';
  triggerProps?: ContextMenuTriggerProps;
  dragHandle?: ReactNode;
  preview?: boolean;
}

/** Post individual card on the phone board: same family as the fluxo card. */
export function PhonePostProcessCard({
  entity,
  onOpen,
  onForward,
  forwardLabel,
  triggerProps,
  dragHandle,
  preview,
}: PhonePostProcessCardProps) {
  const registry = useStatusRegistry();
  const post = entity.process.post;
  const hasDeadline = entity.prazoEfetivo != null;
  const tone = hasDeadline ? deadlineTone(entity.deadline) : 'ok';
  const TipoIcon = TIPO_ICONS[post.tipo];
  const etapaIdx = entity.steps.findIndex((s) => s.ordem === entity.etapaOrdem);
  const title = entity.titulo || 'Post sem título';
  const clienteNome = entity.cliente?.nome ?? post.cliente_nome ?? '—';
  return (
    <article
      className="phone-ent-card phone-ent-card--post"
      data-tone={tone}
      aria-label={preview ? undefined : `${title}, post individual`}
      data-testid={preview ? undefined : 'phone-post-process-card'}
    >
      <button
        type="button"
        className="phone-ent-card__main"
        onClick={onOpen}
        disabled={preview || !onOpen}
        tabIndex={preview ? -1 : undefined}
      >
        <span className="phone-ent-card__top">
          <span className="phone-ent-card__client">
            <span className="phone-ent-card__thumb" aria-hidden="true">
              {entity.cover?.media_lost_at ? (
                <MediaUnavailable size="compact" />
              ) : entity.cover ? (
                <img src={entity.cover.thumbnail_url ?? entity.cover.url} alt="" loading="lazy" />
              ) : (
                <TipoIcon size={13} />
              )}
            </span>
            <span className="phone-ent-card__client-name">
              {clienteNome} · {TIPO_LABELS[post.tipo]}
            </span>
            <span
              className="phone-ent-card__badge"
              role="img"
              aria-label="Processo individual"
              title="Processo individual"
            >
              <FileText size={11} aria-hidden="true" />
            </span>
          </span>
          <span className="phone-ent-card__deadline" data-tone={tone}>
            {hasDeadline ? relativeDeadline(entity.deadline) : 'Sem prazo'}
          </span>
        </span>
        <strong className="phone-ent-card__title">{title}</strong>
        <span className="phone-ent-card__status">
          <PostStatusChip post={post} registry={registry} />
        </span>
      </button>
      <div className="phone-ent-card__foot">
        <span className="phone-ent-card__meta">
          <span className="phone-ent-card__meta-text">
            {entity.responsavel?.nome ?? 'Sem responsável'} · {entity.etapaNome}
          </span>
          <Progress
            idx={etapaIdx}
            total={entity.steps.length}
            label={`Progresso do processo: ${entity.etapaNome}`}
          />
        </span>
        {dragHandle ? (
          dragHandle
        ) : preview ? null : (
          <>
            {triggerProps && (
              <button
                {...triggerProps}
                className="phone-ent-card__icon-btn"
                aria-label={`Mais ações de ${title}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
            )}
            {onForward && (
              <button
                type="button"
                className="phone-ent-card__icon-btn phone-ent-card__forward"
                aria-label={forwardLabel ?? 'Avançar etapa'}
                onClick={onForward}
              >
                <Check aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** Drag handle for Reordenar mode (listeners go on it, nothing else drags). */
export function PhoneDragHandle({
  label,
  ...listeners
}: { label: string } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="phone-ent-card__icon-btn phone-ent-card__handle"
      aria-label={label}
      {...listeners}
    >
      <GripVertical aria-hidden="true" />
    </button>
  );
}
