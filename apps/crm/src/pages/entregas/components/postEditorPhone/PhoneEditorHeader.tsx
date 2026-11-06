import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronLeft, MoreHorizontal } from 'lucide-react';
import { ActionSheet, BottomSheet, Cell, GroupedList, PhoneIconButton } from '@/components/mobile';
import { useSheetActions } from '@/components/mobile/sheetActions';
import type { WorkflowPost } from '../../../../store';
import { isVisibleToClient, VISIBILITY_OPTION_SUFFIX } from '../../postLabels';
import { groupOptionsByOwner, type StatusKey, type StatusRegistry } from '../../statusRegistry';
import { PostStatusChip } from '../PostStatusChip';
import type { PhoneMenuAction } from './types';

interface PhoneEditorHeaderProps {
  post: WorkflowPost;
  registry: StatusRegistry;
  subtitle?: React.ReactNode;
  saving?: boolean;
  menuActions: PhoneMenuAction[];
  onBack: () => void;
  onStatusChange: (key: StatusKey) => void;
  /** Controlled: Detalhes' Status row opens the same list. */
  statusOpen: boolean;
  onStatusOpenChange: (open: boolean) => void;
  /** Flags next to the status chip (e.g. "Aprovado com 2 comentários em aberto"). */
  extra?: React.ReactNode;
}

/**
 * Editor header (EditorConteudo mockup): back, save state, "…" menu, the post title,
 * the status chip that opens the status list, and the client · flow line.
 */
export function PhoneEditorHeader({
  post,
  registry,
  subtitle,
  saving,
  menuActions,
  onBack,
  onStatusChange,
  statusOpen,
  onStatusOpenChange: setStatusOpen,
  extra,
}: PhoneEditorHeaderProps) {
  const { t } = useTranslation('postEditor');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const current = registry.resolve(post);

  return (
    <header className="phone-editor-header">
      <div className="phone-editor-header__bar">
        <PhoneIconButton label={t('actions.back')} onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
        </PhoneIconButton>
        <div className="phone-editor-header__trailing">
          <span className="phone-editor-header__save" role="status">
            {saving ? t('phoneEditorHeader.saving') : t('phoneEditorHeader.saved')}
          </span>
          <PhoneIconButton
            ref={menuButtonRef}
            label={t('phoneEditorHeader.moreActions')}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal aria-hidden="true" />
          </PhoneIconButton>
        </div>
      </div>
      <h1 className="phone-editor-header__title">
        {post.titulo || t('standalonePostDrawer.untitled')}
      </h1>
      <div className="phone-editor-header__meta">
        <button
          ref={statusButtonRef}
          type="button"
          className="phone-editor-status"
          aria-label={t('phoneEditorHeader.statusButton', { status: current.label })}
          aria-haspopup="dialog"
          aria-expanded={statusOpen}
          onClick={() => setStatusOpen(true)}
        >
          <PostStatusChip post={post} registry={registry} />
          <ChevronDown aria-hidden="true" className="phone-editor-status__chevron" />
        </button>
        {extra}
        {subtitle && <span className="phone-editor-header__subtitle">{subtitle}</span>}
      </div>

      <ActionSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title={t('phoneEditorHeader.postActions')}
        hideTitle
        returnFocusRef={menuButtonRef}
        actions={menuActions.map((a) => ({
          label: a.label,
          onSelect: a.onSelect,
          destructive: a.destructive,
          disabled: a.disabled,
          icon: a.icon,
          immediate: a.immediate,
        }))}
      />

      <BottomSheet
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title={t('shared.status')}
        detents={['medium', 'large']}
        returnFocusRef={statusButtonRef}
      >
        <StatusOptions
          registry={registry}
          currentKey={current.key}
          onPick={(key) => {
            if (key !== current.key) onStatusChange(key);
          }}
        />
      </BottomSheet>
    </header>
  );
}

/** Same grouped options as the desktop `<select>` (owner groups, client visibility). */
function StatusOptions({
  registry,
  currentKey,
  onPick,
}: {
  registry: StatusRegistry;
  currentKey: StatusKey;
  onPick: (key: StatusKey) => void;
}) {
  const { closeThen } = useSheetActions();
  return (
    <>
      {groupOptionsByOwner(registry.options).map((group) => (
        <GroupedList key={group.owner} header={group.label} headerAs="h3">
          {group.options.map((o) => (
            <Cell
              key={o.key}
              label={o.kind === 'custom' ? `· ${o.label}` : o.label}
              subtitle={
                isVisibleToClient(o.canonical)
                  ? VISIBILITY_OPTION_SUFFIX.visible
                  : VISIBILITY_OPTION_SUFFIX.internal
              }
              current={o.key === currentKey}
              accessory={
                o.key === currentKey ? (
                  <Check aria-hidden="true" className="phone-editor-check" />
                ) : undefined
              }
              // Close first: a status that needs confirmation opens the host's
              // AlertDialog, which must not open under a closing sheet.
              onClick={() => closeThen(() => onPick(o.key))}
            />
          ))}
        </GroupedList>
      ))}
    </>
  );
}
