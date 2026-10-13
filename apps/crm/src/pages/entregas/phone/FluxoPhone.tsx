import { useState, type HTMLAttributes } from 'react';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  CalendarClock,
  ChevronLeft,
  Clock,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  GripVertical,
  ImageIcon,
  Link as LinkIcon,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Send,
  Trash2,
  Unlink,
} from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { ContextMenu, type ContextMenuAction } from '@/components/mobile/ContextMenu';
import { LargeTitleHeader, PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { copyAppLink } from '@/lib/copyAppLink';
import { buildHubPostLink } from '@/lib/hubLinks';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { formatPostDate } from '@/utils/postDate';
import type {
  PostApproval,
  PostEditSuggestion,
  PostProcessEvent,
  PostStatusEvent,
  WorkflowPost,
} from '../../../store';
import { TIPO_LABELS, isVisibleToClient, VISIBILITY_BADGE_LABEL } from '../postLabels';
import { TIPO_ICONS } from '../tipoIcons';
import { isEligibleToScheduleNow } from '../autoScheduleNudge';
import { AutoScheduleBadge } from '../components/AutoScheduleBadge';
import { PostStatusChip } from '../components/PostStatusChip';
import { PostTimelineList } from '../components/PostTimelinePopover';
import { buildPostTimeline } from '../components/postTimeline';

/**
 * Phone pieces of the Fluxo screen (WorkflowDrawer below 768px, PLAN C3.7). The drawer
 * keeps every bit of state and every handler; these only lay them out the iOS way.
 */

export type FluxoPhoneListMode = 'normal' | 'select' | 'reorder';
export type FluxoDrawerView = 'posts' | 'calendar' | 'grid' | 'history';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ── Header ──────────────────────────────────────────────────────────────────

export interface FluxoPhoneHeaderProps {
  workflowId: number;
  title: string;
  clienteNome?: string | null;
  etapaNome: string;
  readyToSend: number;
  isSending: boolean;
  onSend: () => void;
  onClose: () => void;
  view: FluxoDrawerView;
  onViewChange: (view: FluxoDrawerView) => void;
  /** id of the drawer body, the panel every tab controls. */
  panelId: string;
  tabIdPrefix: string;
}

const VIEW_OPTIONS: { value: FluxoDrawerView; label: string }[] = [
  { value: 'posts', label: 'Posts' },
  { value: 'grid', label: 'Grade' },
  { value: 'calendar', label: 'Calendário' },
  { value: 'history', label: 'Histórico' },
];

export function FluxoPhoneHeader({
  workflowId,
  title,
  clienteNome,
  etapaNome,
  readyToSend,
  isSending,
  onSend,
  onClose,
  view,
  onViewChange,
  panelId,
  tabIdPrefix,
}: FluxoPhoneHeaderProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const sendLabel = `Enviar ${readyToSend} ${plural(readyToSend, 'post aprovado', 'posts aprovados')} ao cliente`;

  const actions: ActionSheetAction[] = [
    ...(readyToSend > 0
      ? [
          {
            label: sendLabel,
            icon: <Send />,
            disabled: isSending,
            onSelect: onSend,
          },
        ]
      : []),
    {
      label: 'Copiar link do fluxo',
      icon: <LinkIcon />,
      onSelect: () => void copyAppLink(`/entregas?drawer=${workflowId}`),
    },
  ];

  return (
    <>
      <LargeTitleHeader
        as="h2"
        className="phone-ent-fluxo__header"
        title={title}
        subtitle={clienteNome ? `${clienteNome} · Etapa: ${etapaNome}` : `Etapa: ${etapaNome}`}
        leading={
          <button
            type="button"
            className="phone-ent-fluxo__back"
            aria-label="Voltar para Entregas"
            onClick={onClose}
          >
            <ChevronLeft aria-hidden="true" />
            <span aria-hidden="true">Entregas</span>
          </button>
        }
        trailing={
          <PhoneIconButton
            label="Ações do fluxo"
            aria-haspopup="dialog"
            onClick={() => setActionsOpen(true)}
          >
            <MoreHorizontal aria-hidden="true" />
          </PhoneIconButton>
        }
      >
        {readyToSend > 0 && (
          <button
            type="button"
            className="phone-ent-fluxo__send"
            onClick={onSend}
            disabled={isSending}
            aria-label={sendLabel}
          >
            <Send aria-hidden="true" />
            Enviar ao cliente ({readyToSend})
          </button>
        )}
        <SegmentedControl
          semantics="tablist"
          aria-label="Visão do fluxo"
          className="phone-ent-fluxo__tabs"
          value={view}
          onChange={onViewChange}
          options={VIEW_OPTIONS.map((o) => ({
            ...o,
            id: `${tabIdPrefix}-${o.value}`,
            controls: panelId,
          }))}
        />
      </LargeTitleHeader>
      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Ações do fluxo"
        hideTitle
        actions={actions}
      />
    </>
  );
}

// ── Posts toolbar ───────────────────────────────────────────────────────────

export interface FluxoPhonePostsToolbarProps {
  mode: FluxoPhoneListMode;
  onModeChange: (mode: FluxoPhoneListMode) => void;
  postsCount: number;
  approvedCount: number;
  clientFacingCount: number;
  awaitingAutoScheduleCount: number;
  onBatchSchedule: () => void;
  onAddPost: () => void;
  onSelectAll: () => void;
}

export function FluxoPhonePostsToolbar({
  mode,
  onModeChange,
  postsCount,
  approvedCount,
  clientFacingCount,
  awaitingAutoScheduleCount,
  onBatchSchedule,
  onAddPost,
  onSelectAll,
}: FluxoPhonePostsToolbarProps) {
  const counter =
    clientFacingCount > 0
      ? `${approvedCount} de ${clientFacingCount} aprovados pelo cliente`
      : `${postsCount} ${plural(postsCount, 'post', 'posts')}`;

  return (
    <div className="phone-ent-fluxo__toolbar">
      <div className="phone-ent-fluxo__toolbar-row">
        <span className="phone-ent-fluxo__count">{counter}</span>
        <div className="phone-ent-fluxo__toolbar-actions">
          {mode === 'select' ? (
            <>
              <button type="button" className="phone-ent-fluxo__link" onClick={onSelectAll}>
                Selecionar todos
              </button>
              <button
                type="button"
                className="phone-ent-fluxo__link"
                onClick={() => onModeChange('normal')}
              >
                Cancelar
              </button>
            </>
          ) : mode === 'reorder' ? (
            <button
              type="button"
              className="phone-ent-fluxo__link phone-ent-fluxo__link--strong"
              onClick={() => onModeChange('normal')}
            >
              Concluir
            </button>
          ) : (
            postsCount > 0 && (
              <>
                {postsCount > 1 && (
                  <button
                    type="button"
                    className="phone-ent-fluxo__link"
                    onClick={() => onModeChange('reorder')}
                  >
                    Reordenar
                  </button>
                )}
                <button
                  type="button"
                  className="phone-ent-fluxo__link"
                  onClick={() => onModeChange('select')}
                >
                  Selecionar
                </button>
              </>
            )
          )}
        </div>
      </div>
      {mode === 'normal' && (
        <div className="phone-ent-fluxo__toolbar-row phone-ent-fluxo__toolbar-row--wrap">
          <button type="button" className="phone-ent-fluxo__new" onClick={onAddPost}>
            <Plus aria-hidden="true" /> Novo Post
          </button>
          {awaitingAutoScheduleCount > 0 && (
            <button
              type="button"
              className="auto-schedule-badge auto-schedule-badge--action"
              onClick={onBatchSchedule}
              title="Agendar de uma vez os posts aprovados que ainda têm data válida."
            >
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {awaitingAutoScheduleCount} aguardando agendamento automático
            </button>
          )}
        </div>
      )}
      {mode === 'reorder' && (
        <p className="phone-ent-fluxo__hint">Arraste pela alça para mudar a ordem dos posts.</p>
      )}
    </div>
  );
}

// ── Selection bar ───────────────────────────────────────────────────────────

export interface FluxoPhoneSelectionBarProps {
  count: number;
  onMove: () => void;
  onDetach: () => void;
  onSend: () => void;
  sending?: boolean;
}

export function FluxoPhoneSelectionBar({
  count,
  onMove,
  onDetach,
  onSend,
  sending = false,
}: FluxoPhoneSelectionBarProps) {
  return (
    <BottomActionBar className="phone-ent-fluxo__bar" data-testid="phone-ent-fluxo-selection-bar">
      <span className="phone-ent-fluxo__bar-count" aria-live="polite">
        {count} {plural(count, 'selecionado', 'selecionados')}
      </span>
      <button
        type="button"
        className="phone-ent-fluxo__bar-btn phone-ent-fluxo__bar-btn--primary"
        disabled={count === 0 || sending}
        onClick={onSend}
      >
        Enviar ao cliente
      </button>
      <div className="phone-ent-fluxo__bar-actions">
        <button
          type="button"
          className="phone-ent-fluxo__bar-btn"
          disabled={count === 0}
          onClick={onMove}
        >
          Mover para outro fluxo
        </button>
        <button
          type="button"
          className="phone-ent-fluxo__bar-btn"
          disabled={count === 0}
          onClick={onDetach}
        >
          Desmembrar
        </button>
      </div>
    </BottomActionBar>
  );
}

// ── Post row ────────────────────────────────────────────────────────────────

export interface FluxoPhonePostRowProps {
  post: WorkflowPost;
  mode: FluxoPhoneListMode;
  hubUrl?: string;
  isExpanded: boolean;
  isSaving: boolean;
  isSelected: boolean;
  hasMedia: boolean;
  editSuggestion: PostEditSuggestion | null;
  referenceCount: number;
  commentCount: number;
  approvals: PostApproval[];
  statusEvents: PostStatusEvent[];
  processEvents: PostProcessEvent[];
  showAutoScheduleBadge: boolean;
  onAutoScheduleClick: () => void;
  /** dnd-kit's `attributes` + `listeners`, spread on the handle only (Reordenar mode). */
  dragHandleProps: HTMLAttributes<HTMLElement>;
  onToggle: () => void;
  onSelectChange: (checked: boolean) => void;
  onDuplicateRequest?: () => void;
  onMoveRequest: () => void;
  onDetachRequest: () => void;
  onDelete: () => void;
}

async function copyHubPostLink(hubUrl: string, postId: number) {
  // Same action as the desktop CopyPostLinkButton.
  try {
    await navigator.clipboard.writeText(buildHubPostLink(hubUrl, postId));
    toast.success('Link copiado!');
  } catch {
    toast.error('Não foi possível copiar o link.');
  }
}

/**
 * The collapsed row of a post on phones: an iOS cell (tipo tile, title, "Tipo · data",
 * status and badges). Tap = the drawer's expand/collapse; in Selecionar mode tap toggles
 * the checkbox. Hold or "…" opens every action the desktop row has; in Reordenar the
 * handle owns the gesture and the menu is off.
 */
export function FluxoPhonePostRow({
  post,
  mode,
  hubUrl,
  isExpanded,
  isSaving,
  isSelected,
  hasMedia,
  editSuggestion,
  referenceCount,
  commentCount,
  approvals,
  statusEvents,
  processEvents,
  showAutoScheduleBadge,
  onAutoScheduleClick,
  dragHandleProps,
  onToggle,
  onSelectChange,
  onDuplicateRequest,
  onMoveRequest,
  onDetachRequest,
  onDelete,
}: FluxoPhonePostRowProps) {
  const registry = useStatusRegistry();
  const [historyOpen, setHistoryOpen] = useState(false);
  const title = post.titulo || 'Post sem título';
  const TipoIcon = TIPO_ICONS[post.tipo] ?? ImageIcon;
  const publishIso = post.published_at || post.scheduled_at || null;
  const dateLabel = publishIso ? formatPostDate(publishIso) : 'A definir';
  const postId = post.id!;
  const visibilityLabel = isVisibleToClient(post.status)
    ? VISIBILITY_BADGE_LABEL.visible
    : VISIBILITY_BADGE_LABEL.internal;

  const sections: ContextMenuAction[][] = [
    [
      {
        label: 'Copiar link do post',
        icon: <Copy />,
        onSelect: () => void copyAppLink(`/entregas?post=${postId}`),
      },
      ...(hubUrl
        ? [
            {
              label: 'Copiar link da postagem no Hub',
              icon: <LinkIcon />,
              onSelect: () => void copyHubPostLink(hubUrl, postId),
            },
          ]
        : []),
    ],
    [
      ...(onDuplicateRequest
        ? [
            {
              label: 'Duplicar post',
              icon: <CopyPlus />,
              // With a content save pending or in flight the copy would miss the edit.
              disabled: isSaving,
              onSelect: onDuplicateRequest,
            },
          ]
        : []),
      { label: 'Mover para outro fluxo', icon: <ArrowRightLeft />, onSelect: onMoveRequest },
      { label: 'Desmembrar do fluxo', icon: <Unlink />, onSelect: onDetachRequest },
      { label: 'Histórico do post', icon: <Clock />, onSelect: () => setHistoryOpen(true) },
    ],
    [{ label: 'Remover post', icon: <Trash2 />, destructive: true, onSelect: onDelete }],
  ];

  const onRowClick = () => {
    if (mode === 'select') onSelectChange(!isSelected);
    else onToggle();
  };

  return (
    <>
      <ContextMenu
        label="Ações do post"
        sections={sections}
        disabled={mode !== 'normal'}
        className="phone-ent-fluxo-row__hold"
      >
        {({ triggerProps }) => (
          <div
            className="phone-ent-fluxo-row"
            data-mode={mode}
            data-selected={mode === 'select' && isSelected ? 'true' : undefined}
            onClick={onRowClick}
          >
            {mode === 'select' && (
              <Checkbox
                className="phone-ent-fluxo-row__check"
                checked={isSelected}
                onCheckedChange={(checked) => onSelectChange(checked === true)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Selecionar ${title}`}
              />
            )}
            {mode === 'reorder' && (
              <span
                {...dragHandleProps}
                className="phone-ent-fluxo-row__handle"
                aria-label={`Arrastar ${title}`}
                data-testid="phone-ent-fluxo-drag-handle"
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical aria-hidden="true" />
              </span>
            )}
            <span className="phone-ent-fluxo-row__tile" aria-hidden="true">
              <TipoIcon />
            </span>
            <div className="phone-ent-fluxo-row__body">
              {/* The row's own click handler does the work; this button is the keyboard
                  and screen-reader stop (Enter/Space click bubbles to the row). */}
              <button
                type="button"
                className="phone-ent-fluxo-row__main"
                aria-expanded={mode === 'select' ? undefined : isExpanded}
              >
                <span className="phone-ent-fluxo-row__title">{title}</span>
                <span className="phone-ent-fluxo-row__sub">
                  {TIPO_LABELS[post.tipo]} · {dateLabel}
                </span>
              </button>
              <div className="phone-ent-fluxo-row__meta">
                <PostStatusChip post={post} registry={registry} />
                <span
                  className={`drawer-post-visibility${isVisibleToClient(post.status) ? ' is-visible' : ''}`}
                  title={visibilityLabel}
                  aria-label={visibilityLabel}
                >
                  {isVisibleToClient(post.status) ? (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </span>
                {isSaving && <span className="drawer-saving-indicator">Salvando…</span>}
                {editSuggestion && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800">
                    Sugestão pendente
                  </span>
                )}
                {referenceCount > 0 && (
                  <Badge
                    variant="info"
                    size="sm"
                    className="inline-flex items-center gap-1"
                    title="Referências enviadas pelo cliente no Hub"
                  >
                    <Paperclip className="h-3 w-3" aria-hidden="true" />
                    {referenceCount === 1 ? '1 referência' : `${referenceCount} referências`}
                  </Badge>
                )}
                {commentCount > 0 && (
                  <span
                    className="drawer-post-comment-badge"
                    title={`${commentCount} ${plural(commentCount, 'comentário', 'comentários')}`}
                  >
                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                    {commentCount}
                  </span>
                )}
                {hasMedia && (
                  <span
                    className="drawer-post-media-badge"
                    title="Mídia anexada"
                    aria-label="Mídia anexada"
                  >
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                )}
                {showAutoScheduleBadge && mode === 'normal' && (
                  <AutoScheduleBadge
                    onClick={onAutoScheduleClick}
                    needsDate={!isEligibleToScheduleNow(post.scheduled_at)}
                  />
                )}
              </div>
            </div>
            {mode === 'normal' && (
              <button
                {...triggerProps}
                className="phone-ent-fluxo-row__more"
                aria-label={`Ações do post ${title}`}
                onClick={(e) => {
                  // The row toggles the post on click: opening the menu must not expand it.
                  e.stopPropagation();
                  triggerProps.onClick();
                }}
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </ContextMenu>
      <BottomSheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="Histórico do post"
        description={title}
        detents={['medium', 'large']}
      >
        <div className="phone-ent-fluxo-history">
          <PostTimelineList
            nodes={buildPostTimeline(post, statusEvents, approvals, processEvents)}
          />
        </div>
      </BottomSheet>
    </>
  );
}
