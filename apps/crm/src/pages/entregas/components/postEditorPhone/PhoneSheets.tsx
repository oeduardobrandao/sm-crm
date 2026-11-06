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
import { useAcceptSuggestionFlow } from '../AcceptSuggestionDialog';
import {
  SuggestionFieldDiff,
  TeamOnlyFooter,
  UnchangedFieldsLine,
  useSuggestionFieldName,
  visibleSuggestionStates,
} from '../SuggestionReview';
import {
  acceptAvailability,
  suggestionFieldStates,
  teamOnlyChangedFields,
  type SuggestionField,
  type SuggestionLivePost,
} from '../../editSuggestionFields';
import { PostTimelineList } from '../PostTimelinePopover';
import { buildPostTimeline } from '../postTimeline';

/**
 * Client edit suggestion (EditorSugestao mockup): the same diffs desktop shows in place
 * of the editor, and the same Rejeitar / Aceitar commands (the host still confirms the
 * rejection). The sheet closes before either command runs, so the host's confirmation
 * never opens under a closing sheet. `post` carries the live Geral row the host fetched
 * (`useSuggestionGeralTarget`); `reviewable` lists the fields the post carries.
 */
export function PhoneSuggestionSheet({
  open,
  onOpenChange,
  suggestion,
  post,
  reviewable,
  clientName,
  resolvedContent,
  resolvedSuggestion,
  onAccept,
  onReject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: PostEditSuggestion | null;
  post: SuggestionLivePost;
  reviewable: SuggestionField[];
  clientName?: string | null;
  resolvedContent: Record<string, unknown> | null;
  resolvedSuggestion: Record<string, unknown> | null;
  onAccept: (
    s: PostEditSuggestion,
    fields: SuggestionField[],
    acknowledged: SuggestionField[],
  ) => void;
  onReject: (id: number) => void;
}) {
  const { t } = useTranslation('postEditor');
  // The conflict dialog lives out here, not in the sheet body: the body unmounts with the sheet,
  // and the dialog has to open after the sheet closed.
  const acceptFlow = useAcceptSuggestionFlow(post, onAccept);
  return (
    <>
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
            reviewable={reviewable}
            clientName={clientName}
            resolvedContent={resolvedContent}
            resolvedSuggestion={resolvedSuggestion}
            onAccept={acceptFlow.request}
            onReject={onReject}
          />
        )}
      </BottomSheet>
      {acceptFlow.dialog}
    </>
  );
}

function SuggestionBody({
  suggestion,
  post,
  reviewable,
  clientName,
  resolvedContent,
  resolvedSuggestion,
  onAccept,
  onReject,
}: {
  suggestion: PostEditSuggestion;
  post: SuggestionLivePost;
  reviewable: SuggestionField[];
  clientName?: string | null;
  resolvedContent: Record<string, unknown> | null;
  resolvedSuggestion: Record<string, unknown> | null;
  onAccept: (s: PostEditSuggestion) => void;
  onReject: (id: number) => void;
}) {
  const { t } = useTranslation('postEditor');
  const { closeThen } = useSheetActions();
  const fieldName = useSuggestionFieldName();
  const states = suggestionFieldStates(post, suggestion);
  const teamOnly = teamOnlyChangedFields(post, suggestion);
  const { canAccept, needsReview } = acceptAvailability(states);
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
      {visibleSuggestionStates(states, resolvedContent, resolvedSuggestion).map((st) => (
        <section key={st.field} className="phone-suggestion__block">
          <h3 className="phone-group__header">
            {st.field === 'texto' ? t('shared.scriptAndBrief') : fieldName(st.field, 'heading')}
          </h3>
          <div className="phone-suggestion__card">
            <SuggestionFieldDiff
              field={st.field}
              state={st}
              post={post}
              suggestion={suggestion}
              resolvedContent={resolvedContent}
              resolvedSuggestion={resolvedSuggestion}
            />
          </div>
        </section>
      ))}
      <UnchangedFieldsLine states={states} reviewable={reviewable} className="mx-1 mb-3" />
      <TeamOnlyFooter teamOnly={teamOnly} className="mx-1 mb-4" />
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
          disabled={!canAccept}
        >
          {needsReview ? t('suggestionReview.acceptReview') : t('shared.accept')}
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
