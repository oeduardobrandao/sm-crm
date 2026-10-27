import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { BottomSheet } from '@/components/mobile';
import { useSheetActions } from '@/components/mobile/sheetActions';
import type {
  PostApproval,
  PostEditSuggestion,
  PostProcessEvent,
  PostStatusEvent,
  WorkflowPost,
} from '../../../../store';
import { computeWordDiff } from '@/utils/textDiff';
import { computeTipTapDiff } from '@/utils/tiptapDiff';
import { DiffView } from '../DiffView';
import { ReadOnlyTipTap } from '../ReadOnlyTipTap';
import { PostTimelineList } from '../PostTimelinePopover';
import { buildPostTimeline } from '../postTimeline';

/**
 * Client edit suggestion (EditorSugestao mockup): the same diffs desktop shows in place
 * of the editor, and the same Rejeitar / Aceitar commands (the host still confirms the
 * rejection). The sheet closes before either command runs, so the host's confirmation
 * never opens under a closing sheet.
 */
export function PhoneSuggestionSheet({
  open,
  onOpenChange,
  suggestion,
  post,
  clientName,
  resolvedContent,
  resolvedSuggestion,
  onAccept,
  onReject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: PostEditSuggestion | null;
  post: WorkflowPost;
  clientName?: string | null;
  resolvedContent: Record<string, unknown> | null;
  resolvedSuggestion: Record<string, unknown> | null;
  onAccept: (s: PostEditSuggestion) => void;
  onReject: (id: number) => void;
}) {
  const { t } = useTranslation('postEditor');
  return (
    <BottomSheet
      open={open && !!suggestion}
      onOpenChange={onOpenChange}
      title={t('shared.clientSuggestion')}
      detents={['large']}
    >
      {suggestion && (
        <SuggestionBody
          suggestion={suggestion}
          post={post}
          clientName={clientName}
          resolvedContent={resolvedContent}
          resolvedSuggestion={resolvedSuggestion}
          onAccept={onAccept}
          onReject={onReject}
        />
      )}
    </BottomSheet>
  );
}

function SuggestionBody({
  suggestion,
  post,
  clientName,
  resolvedContent,
  resolvedSuggestion,
  onAccept,
  onReject,
}: {
  suggestion: PostEditSuggestion;
  post: WorkflowPost;
  clientName?: string | null;
  resolvedContent: Record<string, unknown> | null;
  resolvedSuggestion: Record<string, unknown> | null;
  onAccept: (s: PostEditSuggestion) => void;
  onReject: (id: number) => void;
}) {
  const { t } = useTranslation('postEditor');
  const { closeThen } = useSheetActions();
  return (
    <div className="phone-suggestion">
      <p className="phone-suggestion__meta">
        {clientName || t('postApprovalBubble.client')} ·{' '}
        {new Date(suggestion.updated_at).toLocaleDateString(getIntlLocale(), {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
      {suggestion.changed_fields.includes('conteudo') && resolvedContent && resolvedSuggestion && (
        <section className="phone-suggestion__block">
          <h3 className="phone-group__header">{t('shared.scriptAndBrief')}</h3>
          <div className="phone-suggestion__card">
            <ReadOnlyTipTap content={computeTipTapDiff(resolvedContent, resolvedSuggestion)} />
          </div>
        </section>
      )}
      {suggestion.changed_fields.includes('ig_caption') && (
        <section className="phone-suggestion__block">
          <h3 className="phone-group__header">{t('shared.igCaption')}</h3>
          <div className="phone-suggestion__card">
            <DiffView
              segments={computeWordDiff(
                post.ig_caption ?? '',
                suggestion.suggested_ig_caption ?? '',
              )}
            />
          </div>
        </section>
      )}
      <p className="phone-suggestion__legend">
        <span className="phone-suggestion__legend-out">{t('phoneSuggestionSheet.out')}</span>
        <span className="phone-suggestion__legend-in">{t('phoneSuggestionSheet.in')}</span>
      </p>
      <div className="phone-suggestion__actions">
        <button
          type="button"
          className="phone-editor-bar__secondary"
          onClick={() => closeThen(() => onReject(suggestion.id))}
        >
          {t('shared.reject')}
        </button>
        <button
          type="button"
          className="phone-editor-bar__primary phone-editor-bar__primary--success"
          onClick={() => closeThen(() => onAccept(suggestion))}
        >
          {t('shared.accept')}
        </button>
      </div>
    </div>
  );
}

/** "Histórico do post": the desktop row's timeline popover, as a sheet. */
export function PhoneTimelineSheet({
  open,
  onOpenChange,
  post,
  statusEvents,
  approvals,
  processEvents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: Pick<WorkflowPost, 'created_at'>;
  statusEvents: PostStatusEvent[];
  approvals: PostApproval[];
  processEvents?: PostProcessEvent[];
}) {
  const { t } = useTranslation('postEditor');
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('shared.postHistory')}
      detents={['medium', 'large']}
    >
      {open && (
        <PostTimelineList nodes={buildPostTimeline(post, statusEvents, approvals, processEvents)} />
      )}
    </BottomSheet>
  );
}
